"""Transactional email (account verification, password recovery).

Uses the stdlib ``smtplib`` - no extra dependency, Pi/NAS-friendly. When no SMTP
host is configured the message is *logged* instead of sent (dev mode), so the
verification flow is usable locally (copy the link from the server log or a local
catcher such as MailHog) without a real mail provider.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage

from config import settings

logger = logging.getLogger("quon.email")

# Emails are bilingual (DE/EN) to match the user's chosen UI language; German is
# the product default when the language is unknown (e.g. the anti-enumeration
# "already registered" notice, where the real owner's preference isn't looked up).
_DEFAULT_EMAIL_LANG = "de"


def _lang(lang: str | None) -> str:
    return lang if lang in ("de", "en") else _DEFAULT_EMAIL_LANG


class EmailError(RuntimeError):
    """Raised when a message could not be delivered to a configured SMTP server."""


def _deliver(msg: EmailMessage) -> None:
    """Open an SMTP connection and send one already-built message."""
    context = ssl.create_default_context()
    try:
        # Implicit TLS / SMTPS (e.g. Cloudflare Email Service :465) vs. STARTTLS
        # upgrade on a plain connection (e.g. Brevo/Mailjet :587).
        if settings.smtp_implicit_tls:
            smtp_conn = smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port, timeout=15, context=context
            )
        else:
            smtp_conn = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
        with smtp_conn as smtp:
            if not settings.smtp_implicit_tls and settings.smtp_starttls:
                smtp.starttls(context=context)
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        raise EmailError(str(exc)) from exc


def _send(to: str, subject: str, text: str) -> None:
    """Deliver one message, or log it in dev mode (no SMTP host configured)."""
    if not settings.smtp_host:
        logger.warning("[DEV EMAIL] to=%s subject=%s\n%s", to, subject, text)
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    _deliver(msg)


def send_feedback(
    text: str,
    *,
    reply_to: str | None = None,
    image: bytes | None = None,
    image_mime: str | None = None,
) -> None:
    """Send a beta-feedback message to the operator's feedback inbox, with an
    optional screenshot attachment. Recipient = FEEDBACK_EMAIL, else smtp_from."""
    to = settings.feedback_email or settings.smtp_from
    if not settings.smtp_host:
        logger.warning("[DEV EMAIL] feedback to=%s reply_to=%s\n%s", to, reply_to, text)
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = "QUON Beta feedback"
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(text)
    if image and image_mime and image_mime.startswith("image/"):
        subtype = image_mime.split("/", 1)[1] or "png"
        msg.add_attachment(image, maintype="image", subtype=subtype, filename=f"screenshot.{subtype}")
    _deliver(msg)


def send_verification(to: str, token: str, lang: str | None = None) -> None:
    """Send the email-verification link for a new account."""
    link = f"{settings.app_base_url.rstrip('/')}/verify?token={token}"
    ttl = settings.email_token_ttl_hours
    templates = {
        "en": (
            "Verify your QUON account",
            "Welcome to QUON — your private AI gateway.\n\n"
            "Confirm your email to activate your account:\n\n"
            f"{link}\n\n"
            f"This link expires in {ttl} hours. If you didn't sign up, ignore this message.",
        ),
        "de": (
            "Bestätige dein QUON-Konto",
            "Willkommen bei QUON — deinem privaten KI-Zugang.\n\n"
            "Bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren:\n\n"
            f"{link}\n\n"
            f"Dieser Link ist {ttl} Stunden gültig. "
            "Wenn du dich nicht registriert hast, ignoriere diese Nachricht.",
        ),
    }
    _send(to, *templates[_lang(lang)])


def send_password_reset(to: str, token: str, lang: str | None = None) -> None:
    """Send a recovery/password-reset link."""
    link = f"{settings.app_base_url.rstrip('/')}/recover?token={token}"
    ttl = settings.email_token_ttl_hours
    templates = {
        "en": (
            "Reset your QUON password",
            "A password reset was requested for your QUON account.\n\n"
            "You will need your recovery phrase to complete it:\n\n"
            f"{link}\n\n"
            f"This link expires in {ttl} hours. "
            "If you didn't request this, ignore this message — your account is unchanged.",
        ),
        "de": (
            "QUON-Passwort zurücksetzen",
            "Für dein QUON-Konto wurde ein Zurücksetzen des Passworts angefordert.\n\n"
            "Zum Abschließen benötigst du deine Wiederherstellungsphrase:\n\n"
            f"{link}\n\n"
            f"Dieser Link ist {ttl} Stunden gültig. Wenn du das nicht angefordert hast, "
            "ignoriere diese Nachricht — dein Konto bleibt unverändert.",
        ),
    }
    _send(to, *templates[_lang(lang)])


def send_already_registered(to: str, lang: str | None = None) -> None:
    """Notify the owner of an ACTIVE account that someone tried to sign up with
    their address. Sent instead of a verify email so /auth/register can fake
    success without revealing (to the caller) that the account exists."""
    templates = {
        "en": (
            "QUON sign-up attempt with your email address",
            "Someone tried to create a QUON account with this address, but you "
            "already have one.\n\n"
            "If this was you, just sign in — or use 'Forgot password' if you can't "
            "remember your password.\n\n"
            "If it wasn't you, you can safely ignore this email — your account is "
            "unchanged.\n\n"
            "Note: any recovery phrase shown during that sign-up attempt is NOT "
            "active and cannot access your account.",
        ),
        "de": (
            "Registrierungsversuch mit deiner E-Mail-Adresse bei QUON",
            "Jemand hat versucht, mit dieser Adresse ein QUON-Konto zu erstellen, "
            "aber du hast bereits eines.\n\n"
            "Falls du das warst, melde dich einfach an — oder nutze „Passwort vergessen“, "
            "falls du dein Passwort nicht mehr weißt.\n\n"
            "Falls du es nicht warst, kannst du diese E-Mail ignorieren — dein Konto "
            "bleibt unverändert.\n\n"
            "Hinweis: Eine bei diesem Versuch angezeigte Wiederherstellungsphrase ist NICHT "
            "aktiv und gewährt keinen Zugriff auf dein Konto.",
        ),
    }
    _send(to, *templates[_lang(lang)])


def send_email_change(to: str, token: str, lang: str | None = None) -> None:
    """Confirm a requested email change. Sent to the new address; the account's
    email only changes once this link is followed."""
    link = f"{settings.app_base_url.rstrip('/')}/change-email?token={token}"
    ttl = settings.email_token_ttl_hours
    templates = {
        "en": (
            "Confirm your new QUON email address",
            "You requested to change the email address on your QUON account to this "
            "one.\n\n"
            "Confirm the change:\n\n"
            f"{link}\n\n"
            f"This link expires in {ttl} hours. "
            "If you didn't request this, ignore this message — your account is unchanged.",
        ),
        "de": (
            "Bestätige deine neue QUON-E-Mail-Adresse",
            "Du hast angefordert, die E-Mail-Adresse deines QUON-Kontos auf diese zu "
            "ändern.\n\n"
            "Bestätige die Änderung:\n\n"
            f"{link}\n\n"
            f"Dieser Link ist {ttl} Stunden gültig. Wenn du das nicht angefordert hast, "
            "ignoriere diese Nachricht — dein Konto bleibt unverändert.",
        ),
    }
    _send(to, *templates[_lang(lang)])
