SRC = '''
class LinkGarminView(APIView):
    """Link the user's Garmin Connect account.

    The password is used once to obtain OAuth tokens and is never
    stored - only the encrypted token blob is kept.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .garmin import (
            GarminAuthError,
            GarminUnavailableError,
            encrypt_tokens,
            login_and_get_tokens,
            sync_garmin,
        )

        email = (request.data.get("email") or "").strip()
        password = request.data.get("password") or ""
        if not email or not password:
            return Response({"message": "Garmin email and password are required."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            token_blob = login_and_get_tokens(email, password)
        except GarminAuthError:
            # Never forward upstream exception text - it can echo back the
            # account email or internal details (CodeQL stack-trace-exposure).
            logger.info("Garmin login failed for user %s", request.user.pk, exc_info=True)
            return Response({"message": "Garmin login failed - check your credentials (and approve any MFA prompt in the Garmin Connect app first)."},
                            status=status.HTTP_400_BAD_REQUEST)
        except GarminUnavailableError:
            logger.info("Garmin unavailable during link for user %s", request.user.pk, exc_info=True)
            return Response({"message": "Could not reach Garmin - please try again later."},
                            status=status.HTTP_502_BAD_GATEWAY)

        user = request.user
        user.garmin_email = email
        user.garmin_tokens_enc = encrypt_tokens(token_blob)
        user.garmin_last_synced_at = None
        # The first linked provider becomes the activity source; linking a
        # second provider never changes it (the user switches it in the
        # personal settings).
        if not user.activity_source:
            user.activity_source = 'garmin'
        user.save()

        # Only import when Garmin is the user's activity source - with
        # Strava selected, an import would double every activity that
        # exists in both ecosystems.
        if user.get_activity_source() != 'garmin':
            return Response({"message": "Successfully linked Garmin. Strava is currently your activity source, so no Garmin activities were imported - you can switch the source in the personal settings."},
                            status=status.HTTP_200_OK)

        # Initial import of the last ~6 weeks runs in the background -
        # the Garmin SSO roundtrip is slow enough already.
        try:
            sync_garmin.delay(user__id=user.id, days_back=43)
        except Exception as exc:  # noqa: BLE001 - linkage itself succeeded
            logger.warning("Garmin linked but initial sync could not be queued for user %s: %s", user.id, exc)

        return Response({"message": "Successfully linked Garmin. Your recent activities are being imported in the background."},
                        status=status.HTTP_200_OK)


class UnlinkGarminView(APIView):
    """Unlink Garmin Connect and drop the stored tokens."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        user.garmin_email = None
        user.garmin_tokens_enc = None
        user.garmin_last_synced_at = None
        user.save()
        return Response({"message": "Successfully unlinked Garmin."}, status=status.HTTP_200_OK)


class SyncGarminView(APIView):
    """Manually re-sync recent Garmin activities (throttled to hourly)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .garmin import GarminAuthError, GarminUnavailableError, sync_garmin

        user = request.user
        if not user.garmin_tokens_enc:
            return Response({"message": "Garmin is not linked."}, status=status.HTTP_400_BAD_REQUEST)

        if user.get_activity_source() != 'garmin':
            return Response({"message": "Strava is your selected activity source - Garmin import is disabled so activities don't get doubled. You can switch the source in the personal settings."},
                            status=status.HTTP_400_BAD_REQUEST)

        if user.garmin_last_synced_at and user.garmin_last_synced_at > (timezone.now() - datetime.timedelta(minutes=59)):
            return Response({"message": "Too many requests! You can only request a Garmin sync every 60 minutes."},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)

        try:
            result = sync_garmin(user__id=user.id, days_back=14)
        except GarminAuthError:
            logger.info("Garmin auth error during sync for user %s", user.pk, exc_info=True)
            return Response({"message": "Garmin rejected the stored login - please re-link Garmin Connect."},
                            status=status.HTTP_400_BAD_REQUEST)
        except GarminUnavailableError:
            logger.info("Garmin unavailable during sync for user %s", user.pk, exc_info=True)
            return Response({"message": "Could not reach Garmin - please try again later."},
                            status=status.HTTP_502_BAD_GATEWAY)

        return Response({"message": f"Successfully synced Garmin ({result.get('created', 0)} new activities)."},
                        status=status.HTTP_200_OK)


class LinkHealthView(APIView):
    """Link the user to the Open Wearables instance (Apple/Google Health).

    Creates the OW user on first call and always returns a fresh
    single-use invitation code: the athlete enters host + code in the
    health app, which then pushes Apple Health / Health Connect workouts
    to the instance in the background.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .health import (
            HealthConfigError,
            HealthUnavailableError,
            generate_invitation,
            sync_health,
        )

        user = request.user
        try:
            invitation = generate_invitation(user)
        except HealthConfigError:
            return Response({"message": "The Health connector is not configured on this server (Site Settings -> Health)."},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except HealthUnavailableError:
            logger.info("Open Wearables unreachable during health link for user %s", user.pk, exc_info=True)
            return Response({"message": "Could not reach the health sync server - please try again later."},
                            status=status.HTTP_502_BAD_GATEWAY)

        # The first linked provider becomes the activity source; linking
        # another provider never changes it (switched in the settings).
        if not user.activity_source:
            user.activity_source = 'health'
            user.save(update_fields=['activity_source'])

        # Initial import of the last ~6 weeks in the background - only
        # when Health is the user's activity source (otherwise every
        # activity that also exists in the other ecosystem would double).
        if user.get_activity_source() == 'health':
            try:
                sync_health.delay(user__id=user.id, start_datetime=timezone.now() - datetime.timedelta(days=43))
            except Exception as exc:  # noqa: BLE001 - linkage itself succeeded
                logger.warning("Health linked but initial sync could not be queued for user %s: %s", user.id, exc)

        return Response({
            "message": "Health account linked. Enter the connection code in the health app on your phone.",
            "code": invitation["code"],
            "host": invitation["host"],
            "expires_at": invitation["expires_at"],
        }, status=status.HTTP_200_OK)


class UnlinkHealthView(APIView):
    """Unlink the Open Wearables user (workouts already imported are kept)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        user.health_user_id = None
        user.health_last_synced_at = None
        # Never leave the selector pointing at an unlinked provider.
        if user.activity_source == 'health':
            user.activity_source = None
        user.save()
        return Response({"message": "Successfully unlinked Health."}, status=status.HTTP_200_OK)


class SyncHealthView(APIView):
    """Manually re-sync recent Apple/Google Health workouts (hourly cap)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .health import HealthConfigError, HealthUnavailableError, sync_health

        user = request.user
        if not user.health_user_id:
            return Response({"message": "Health is not linked."}, status=status.HTTP_400_BAD_REQUEST)

        if user.get_activity_source() != 'health':
            return Response({"message": "Another provider is your selected activity source - Health import is disabled so activities don't get doubled. You can switch the source in the personal settings."},
                            status=status.HTTP_400_BAD_REQUEST)

        # Short cap: the hourly beat stamps last_synced even on an empty
        # poll, and a 60-minute lock then blocked the Re-Sync button that
        # is supposed to recover a missed phone push. Stamp under a row
        # lock first so two overlapping GETs cannot both skip the cooldown
        # and pin two gunicorn workers on wait_for_ingest.
        from django.db import transaction
        with transaction.atomic():
            locked = type(user).objects.select_for_update().get(pk=user.pk)
            if locked.health_last_synced_at and locked.health_last_synced_at > (timezone.now() - datetime.timedelta(minutes=2)):
                return Response({"message": "Too many requests! You can only request a Health sync every 2 minutes."},
                                status=status.HTTP_429_TOO_MANY_REQUESTS)
            locked.health_last_synced_at = timezone.now()
            locked.save(update_fields=["health_last_synced_at"])

        try:
            result = sync_health(
                user__id=user.id,
                start_datetime=timezone.now() - datetime.timedelta(days=14),
                wait_for_ingest=True,
            )
        except HealthConfigError:
            return Response({"message": "The Health connector is not configured on this server."},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except HealthUnavailableError:
            logger.info("Open Wearables unreachable during health sync for user %s", user.pk, exc_info=True)
            return Response({"message": "Could not reach the health sync server - please try again later."},
                            status=status.HTTP_502_BAD_GATEWAY)

        return Response({"message": f"Successfully synced Health ({result.get('created', 0)} new activities)."},
                        status=status.HTTP_200_OK)
'''
