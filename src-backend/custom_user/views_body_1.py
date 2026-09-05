SRC = '''        newly = serializer.save()
        if newly:
            from .emails.celery_emails import welcome_email
            welcome_email.apply_async(args=[serializer.user.pk])
        return Response({"detail": "Email confirmed."})


class EmailVerifyResendView(APIView):
    """Logged-in user, own inbox only. 10-minute cooldown."""
    permission_classes = [IsAuthenticated]
    throttle_classes = [ClientIPScopedThrottle]
    throttle_scope = 'auth'
    RESEND_COOLDOWN_SECONDS = 10 * 60

    def post(self, request):
        user = request.user
        if user.is_verified:
            return Response({"detail": "This email is already confirmed."})
        key = f"email-verify-resend:{user.pk}"
        if cache.get(key):
            return Response(
                {"detail": "Please wait before requesting another link."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        cache.set(key, 1, self.RESEND_COOLDOWN_SECONDS)
        from .emails.celery_emails import verify_email
        verify_email.apply_async(args=[user.pk])
        return Response({"detail": "Check your inbox for a confirmation link."})


class StravaStateView(APIView):
    """Return a short-lived signed ``state`` token binding the upcoming
    Strava OAuth flow to this user session (CSRF/login-CSRF protection).

    The frontend embeds it in the Strava authorize URL; Strava echoes it
    back; LinkStravaView verifies the signature and that it names the
    same user before exchanging the code.
    """
    permission_classes = [IsAuthenticated]

    STATE_MAX_AGE_SECONDS = 600

    def get(self, request):
        from django.core.signing import TimestampSigner
        state = TimestampSigner().sign(f"strava-link:{request.user.pk}")
        return Response({"state": state}, status=status.HTTP_200_OK)


class LinkStravaView(APIView):
    """ API post view for users to link with Strava. """
    permission_classes = [IsAuthenticated]

    def post(self, request, code, state=""):
        # Verify the OAuth state token: valid signature, fresh, and
        # minted for *this* user - otherwise an attacker could trick a
        # logged-in victim into linking the attacker's Strava account.
        if not state:
            return Response({"message": "Missing Strava session state. Please start the linking again."},
                            status=status.HTTP_400_BAD_REQUEST)
        from django.core.signing import TimestampSigner, BadSignature, SignatureExpired
        try:
            payload = TimestampSigner().unsign(state, max_age=StravaStateView.STATE_MAX_AGE_SECONDS)
        except (BadSignature, SignatureExpired):
            return Response({"message": "Invalid or expired Strava link session. Please start the linking again."},
                            status=status.HTTP_400_BAD_REQUEST)
        if payload != f"strava-link:{request.user.pk}":
            return Response({"message": "Strava link session mismatch. Please start the linking again."},
                            status=status.HTTP_403_FORBIDDEN)

        user = request.user
        from site_settings.models import resolve_strava_settings
        strava_cfg = resolve_strava_settings()
        client_id = strava_cfg["client_id"]
        client_secret = strava_cfg["client_secret"]

        if not client_id or not client_secret:
            return Response({"message": "Sever configuration error - STRAVA_CLIENT_ID and/or STRAVA_CLIENT_SECRET are not set."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            response = requests.post(
                url='https://www.strava.com/oauth/token',
                data={
                    'client_id': client_id,
                    'client_secret': client_secret,
                    'code': code,
                    'grant_type': 'authorization_code'
                },
                timeout=15,
            )
            response.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            if response.status_code == 400:
                # Strava rejected the auth code (already used, expired,
                # or never issued). Surface that to the user.
                return Response({"message": "Invalid or expired Strava linkage code."}, status=status.HTTP_400_BAD_REQUEST)
            return Response({"message": f"Strava token exchange failed ({response.status_code})."}, status=status.HTTP_502_BAD_GATEWAY)
        except requests.RequestException as exc:
            # Network / DNS / TLS error talking to Strava. Don't leak
            # the exception text - it can include the resolved hostname
            # or proxy details.
            return Response({"message": "Could not reach Strava. Please try again later."}, status=status.HTTP_502_BAD_GATEWAY)

        strava_tokens = response.json()
        new_athlete_id = strava_tokens.get('athlete', {}).get('id')

        # If the Strava athlete is already linked to a *different*
        # account on this server, refuse to overwrite it. Otherwise an
        # attacker who happens to be logged into Strava as victim A
        # could use their OAuth code to attach victim A's Strava to
        # their own workout-challenge account.
        if new_athlete_id is not None:
            existing = CustomUser.objects.filter(strava_athlete_id=new_athlete_id).exclude(pk=user.pk).first()
            if existing is not None:
                return Response(
                    {"message": "This Strava account is already linked to a different Workout Challenge user."},
                    status=status.HTTP_409_CONFLICT,
                )

        # Encrypt the refresh token before it touches the DB - a leaked
        # database dump must not hand out live Strava credentials (same
        # treatment the Garmin tokens already get).
        from .token_crypto import encrypt_token
        refresh_token = strava_tokens.get('refresh_token', None)
        setattr(user, 'strava_refresh_token', encrypt_token(refresh_token) if refresh_token else None)
        setattr(user, 'strava_athlete_id', new_athlete_id)
        # The first linked provider becomes the activity source; linking a
        # second provider never changes it (the user switches it in the
        # personal settings).
        if not user.activity_source:
            user.activity_source = 'strava'
        user.save()

        cache.set(f"strava_access_token_{user.id}", strava_tokens.get('access_token', None), int(strava_tokens.get('expires_in', 21600)) - 60)

        # Only import when Strava is the user's activity source - with
        # Garmin selected, an import would double every activity that
        # exists in both ecosystems.
        if user.get_activity_source() != 'strava':
            return Response({"message": "Successfully linked Strava. Garmin is currently your activity source, so no Strava activities were imported - you can switch the source in the personal settings."}, status=status.HTTP_200_OK)

        try:
            running_task = sync_strava.delay(user__id=user.id, start_datetime=datetime.datetime.now() - datetime.timedelta(days=43))
            try:
                running_task.get(timeout=100)
            except TimeoutError:
                logger.info('Strava sync task still running (%s); returning without waiting', running_task.id)
        except requests.exceptions.HTTPError as err:
            if '401 Client Error: Unauthorized' in str(err):
                return Response({'message': 'Access to activities denied by Strava. Not sufficient permissions to download activities.'}, status=status.HTTP_403_FORBIDDEN)
            else:
                return Response({'message': 'Failed to import Strava activities. Please try again later.'}, status=status.HTTP_502_BAD_GATEWAY)
        except Exception:
            # Any other failure in the sync task (or reaching the worker)
            # must not surface as a 500 HTML page - the frontend expects
            # JSON and would otherwise show a bare "parsing error".
            logger.exception("Strava activity import failed unexpectedly for user %s", user.id)
            return Response({'message': 'Strava was linked, but the workout import failed. Please try the sync again later.'}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({"message": "Successfully linked Strava."}, status=status.HTTP_200_OK)


class UnlinkStravaView(APIView):
    """ API post view for users to unlink Strava. """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        setattr(user, 'strava_refresh_token', None)
        setattr(user, 'strava_athlete_id', None)
        user.save()

        # If Strava was unlinked because of a hijacked account, the
        # attacker shouldn't be able to mint a fresh access token. The
        # Strava token is gone; blacklist ours too.
        _blacklist_user_tokens(user)

        return Response({"message": "Successfully unlinked Strava."}, status=status.HTTP_200_OK)


class ResetStravaView(APIView):
    """Reset the Strava connection to a clean slate.

    The repair path for a broken linkage (e.g. Strava invalidated the
    stored refresh token, so every sync fails): wipes every piece of
    connection state - including the cached access token and the sync
    timestamp, which ``UnlinkStravaView`` leaves behind - so the user
    can link again from scratch. Unlike unlink this is not a security
    action, so the user stays logged in (no token blacklisting).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        user.strava_refresh_token = None
        user.strava_athlete_id = None
        user.strava_last_synced_at = None
        user.save(update_fields=['strava_refresh_token', 'strava_athlete_id', 'strava_last_synced_at'])
        cache.delete(f"strava_access_token_{user.id}")

        return Response({"message": "Strava connection reset. You can now link Strava again from scratch."},
                        status=status.HTTP_200_OK)


class SyncStravaView(APIView):
    """ API get view for users to sync Strava. """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        if user.strava_refresh_token is None or user.strava_refresh_token == '':
            return Response({"message": "Strava is not linked."}, status=status.HTTP_400_BAD_REQUEST)

        if user.get_activity_source() != 'strava':
            return Response({"message": "Garmin is your selected activity source - Strava import is disabled so activities don't get doubled. You can switch the source in the personal settings."}, status=status.HTTP_400_BAD_REQUEST)

        if user.strava_last_synced_at is None or user.strava_last_synced_at == '' or user.strava_last_synced_at < (timezone.now() - datetime.timedelta(minutes=59)):
            sync_strava(user__id=user.id)
            return Response({"message": f"Successfully synced Strava."}, status=status.HTTP_200_OK)

        return Response({"message": "Too many requests! You can only request a Strava sync every 60 minutes."}, status=status.HTTP_429_TOO_MANY_REQUESTS)
'''
