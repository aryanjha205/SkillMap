import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_bill_email(customer_email, worker_name, job_details):
    smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
    smtp_port = int(os.getenv('SMTP_PORT', 587))
    sender_email = os.getenv('SMTP_USERNAME')
    password = os.getenv('SMTP_PASSWORD')

    message = MIMEMultipart()
    message["From"] = f"SkillMap Billing <{sender_email}>"
    message["To"] = customer_email
    message["Subject"] = "Service Bill - SkillMap"

    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background-color: #f4f7f6; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
            <h2 style="color: #4F46E5; text-align: center;">INVOICE</h2>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p>Hi,</p>
            <p>Your service for <b>{job_details.get('skill')}</b> has been completed. Below is your bill summary:</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr style="background: #f9fafb;">
                    <th style="text-align: left; padding: 12px; border-bottom: 2px solid #eee;">Description</th>
                    <th style="text-align: right; padding: 12px; border-bottom: 2px solid #eee;">Amount</th>
                </tr>
                <tr>
                    <td style="padding: 12px; border-bottom: 1px solid #eee;">{job_details.get('skill')} (by {worker_name})</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">₹{job_details.get('price')}</td>
                </tr>
                <tr>
                    <td style="padding: 12px; font-weight: bold;">Grand Total</td>
                    <td style="padding: 12px; text-align: right; font-weight: bold; color: #4F46E5;">₹{job_details.get('price')}</td>
                </tr>
            </table>

            <div style="text-align: center; margin-top: 30px;">
                <p style="font-size: 14px; color: #6b7280;">Please pay the amount to the worker via app or cash.</p>
                <div style="background: #EEF2FF; color: #4F46E5; padding: 10px; border-radius: 8px; display: inline-block; font-weight: bold;">
                    Status: UNPAID
                </div>
            </div>
            
            <p style="margin-top: 30px; font-size: 12px; color: #9ca3af; text-align: center;">Thank you for using SkillMap!</p>
        </div>
    </body>
    </html>
    """
    message.attach(MIMEText(body, "html"))

    try:
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(sender_email, password)
        server.sendmail(sender_email, customer_email, message.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"Bill Email error: {e}")
        return False

def send_receipt_email(customer_email, worker_name, job_details):
    smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
    smtp_port = int(os.getenv('SMTP_PORT', 587))
    sender_email = os.getenv('SMTP_USERNAME')
    password = os.getenv('SMTP_PASSWORD')

    message = MIMEMultipart()
    message["From"] = f"SkillMap Payments <{sender_email}>"
    message["To"] = customer_email
    message["Subject"] = "Payment Receipt - SkillMap"

    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background-color: #f4f7f6; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 20px;">
                <span style="background: #D1FAE5; color: #059669; padding: 8px 16px; border-radius: 20px; font-weight: bold; font-size: 14px;">PAID</span>
            </div>
            <h2 style="color: #059669; text-align: center;">PAYMENT RECEIPT</h2>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p>Hi,</p>
            <p>Thank you for your payment. We have successfully received <b>₹{job_details.get('price')}</b> for the services provided by <b>{worker_name}</b>.</p>
            
            <div style="background: #f9fafb; padding: 20px; border-radius: 10px; border: 1px dashed #d1d5db; margin: 20px 0;">
                <p><b>Transaction ID:</b> {job_details.get('id')}</p>
                <p><b>Service:</b> {job_details.get('skill')}</p>
                <p><b>Price:</b> ₹{job_details.get('price')}</p>
                <p><b>Paid On:</b> {job_details.get('updated_at', 'Today')}</p>
            </div>

            <p style="text-align: center; font-size: 14px; color: #6b7280;">This is a system generated receipt.</p>
        </div>
    </body>
    </html>
    """
    message.attach(MIMEText(body, "html"))

    try:
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(sender_email, password)
        server.sendmail(sender_email, customer_email, message.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"Receipt Email error: {e}")
        return False
