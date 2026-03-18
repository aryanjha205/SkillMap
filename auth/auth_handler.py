import datetime
import os
import random
import smtplib

import jwt
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

SECRET_KEY = os.getenv("SECRET_KEY", "skillmap-secret-123")


def generate_otp():
    return str(random.randint(100000, 999999))


def _smtp_config():
    return {
        "server": os.getenv("SMTP_SERVER", "smtp.gmail.com"),
        "port": int(os.getenv("SMTP_PORT", 587)),
        "username": os.getenv("SMTP_USERNAME") or os.getenv("MAIL_DEFAULT_SENDER"),
        "password": os.getenv("SMTP_PASSWORD"),
    }


def send_otp_email(receiver_email, otp):
    config = _smtp_config()
    sender_email = config["username"]
    password = config["password"]

    if not sender_email or not password:
        message = "SMTP username/sender or password is missing"
        print(f"Email error: {message}")
        return {"success": False, "error": message}

    message = MIMEMultipart()
    message["From"] = f"SkillMap <{sender_email}>"
    message["To"] = receiver_email
    message["Subject"] = "Your SkillMap Login OTP"

    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #4F46E5; text-align: center;">SkillMap Verification</h2>
            <p>Hello,</p>
            <p>Your one-time password for logging in is:</p>
            <div style="text-align: center; margin: 30px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #111; background: #f3f4f6; padding: 10px 20px; border-radius: 5px;">{otp}</span>
            </div>
            <p>This code is valid for 10 minutes. Please do not share it with anyone.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #666; text-align: center;">SkillMap secure sign-in</p>
        </div>
    </body>
    </html>
    """
    message.attach(MIMEText(body, "html"))

    try:
        with smtplib.SMTP(config["server"], config["port"], timeout=20) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(sender_email, password)
            server.sendmail(sender_email, receiver_email, message.as_string())
        return {"success": True}
    except smtplib.SMTPAuthenticationError:
        error = "SMTP login failed. Check Gmail app password or SMTP credentials."
    except smtplib.SMTPException as exc:
        error = f"SMTP error: {exc}"
    except Exception as exc:
        error = str(exc)

    print(f"Email error: {error}")
    return {"success": False, "error": error}


def create_token(email):
    payload = {
        "email": email,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=1),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def decode_token(token):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return payload["email"]
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
