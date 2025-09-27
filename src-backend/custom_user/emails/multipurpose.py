import os
from django.conf import settings
from django.core.mail import get_connection
from django.core.mail.message import EmailMultiAlternatives



def send_email(subject, body, to_email, cc=[], reply_to=[]):
    """General function via which all emails are sent out"""
    to_email = [settings.EMAIL_FROM] if (settings.DEBUG or '.local' in to_email.lower()) else [to_email]
    from_email = settings.EMAIL_FROM
    reply_to_email = ([from_email] if settings.EMAIL_REPLY_TO is None else settings.EMAIL_REPLY_TO) if reply_to == [] else reply_to

    print(f'Email Server: {settings.EMAIL_HOST}')
    connection = get_connection()
    mail = EmailMultiAlternatives(
        subject=subject, body="", from_email=from_email, to=to_email, cc=cc, reply_to=reply_to_email, connection=connection
    )
    mail.attach_alternative(body, "text/html")
    mail.content_subtype = "html"

    mail.send()
    print(f'Email "{subject}" sent to {to_email}')
