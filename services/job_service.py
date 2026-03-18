import os
import smtplib
from datetime import datetime
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def _format_amount(value):
    try:
        return f"{float(value or 0):.2f}"
    except (TypeError, ValueError):
        return "0.00"


def _escape_pdf_text(value):
    text = str(value or "")
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_simple_pdf(title, lines):
    text_lines = [title] + [line for line in lines if line]
    stream_lines = ["BT", "/F1 16 Tf", "50 780 Td", "18 TL"]
    for index, line in enumerate(text_lines):
        if index == 0:
            stream_lines.append(f"({_escape_pdf_text(line)}) Tj")
        else:
            stream_lines.append("T*")
            stream_lines.append(f"({_escape_pdf_text(line)}) Tj")
    stream_lines.append("ET")
    stream = "\n".join(stream_lines).encode("latin-1", errors="replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"\nendstream",
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode("latin-1"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")

    xref_start = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010} 00000 n \n".encode("latin-1"))
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_start}\n%%EOF"
        ).encode("latin-1")
    )
    return bytes(pdf)


def _build_invoice_pdf(job_details, worker_name):
    amount = _format_amount(job_details.get("price"))
    created_at = job_details.get("created_at") or datetime.utcnow().isoformat()
    return _build_simple_pdf(
        "SkillMap Invoice",
        [
            f"Invoice ID: {job_details.get('id', 'N/A')}",
            f"Customer: {job_details.get('customer_name') or job_details.get('customer_email') or 'Customer'}",
            f"Partner: {worker_name}",
            f"Service: {job_details.get('skill', 'Service')}",
            f"Created At: {created_at}",
            f"Amount Due: Rs. {amount}",
            "Status: UNPAID",
        ],
    )


def _build_receipt_pdf(job_details, worker_name):
    amount = _format_amount(job_details.get("price"))
    paid_at = job_details.get("updated_at") or datetime.utcnow().isoformat()
    return _build_simple_pdf(
        "SkillMap Payment Receipt",
        [
            f"Receipt ID: {job_details.get('id', 'N/A')}",
            f"Customer: {job_details.get('customer_name') or job_details.get('customer_email') or 'Customer'}",
            f"Partner: {worker_name}",
            f"Service: {job_details.get('skill', 'Service')}",
            f"Paid At: {paid_at}",
            f"Amount Paid: Rs. {amount}",
            "Status: PAID",
        ],
    )


def _send_document_email(
    customer_email,
    *,
    subject,
    sender_label,
    body,
    attachment_name,
    attachment_bytes,
):
    smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", 587))
    sender_email = os.getenv("SMTP_USERNAME") or os.getenv("MAIL_DEFAULT_SENDER")
    password = os.getenv("SMTP_PASSWORD")

    if not customer_email:
        return {"success": False, "error": "Customer email is missing"}
    if not sender_email or not password:
        return {"success": False, "error": "SMTP credentials are missing"}

    message = MIMEMultipart()
    message["From"] = f"{sender_label} <{sender_email}>"
    message["To"] = customer_email
    message["Subject"] = subject
    message.attach(MIMEText(body, "html"))

    attachment = MIMEApplication(attachment_bytes, _subtype="pdf")
    attachment.add_header("Content-Disposition", "attachment", filename=attachment_name)
    message.attach(attachment)

    try:
        with smtplib.SMTP(smtp_server, smtp_port, timeout=20) as server:
            server.starttls()
            server.login(sender_email, password)
            server.sendmail(sender_email, customer_email, message.as_string())
        return {"success": True, "filename": attachment_name}
    except Exception as exc:
        print(f"Email send error: {exc}")
        return {"success": False, "error": str(exc)}


def send_bill_email(customer_email, worker_name, job_details):
    amount = _format_amount(job_details.get("price"))
    invoice_id = (job_details.get("id") or "invoice").split("-")[0]
    pdf_bytes = _build_invoice_pdf(job_details, worker_name)
    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background-color: #f4f7f6; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
            <h2 style="color: #4F46E5; text-align: center;">INVOICE</h2>
            <p>Hi,</p>
            <p>Your service for <b>{job_details.get('skill', 'Service')}</b> has been completed by <b>{worker_name}</b>.</p>
            <p>Total amount due: <b>&#8377;{amount}</b></p>
            <p>Your invoice PDF is attached with this email.</p>
            <div style="margin-top: 24px; background: #EEF2FF; color: #4F46E5; padding: 12px 16px; border-radius: 10px; display: inline-block; font-weight: bold;">
                Status: UNPAID
            </div>
        </div>
    </body>
    </html>
    """
    return _send_document_email(
        customer_email,
        subject="Service Bill - SkillMap",
        sender_label="SkillMap Billing",
        body=body,
        attachment_name=f"invoice-{invoice_id}.pdf",
        attachment_bytes=pdf_bytes,
    )


def send_receipt_email(customer_email, worker_name, job_details):
    amount = _format_amount(job_details.get("price"))
    receipt_id = (job_details.get("id") or "receipt").split("-")[0]
    pdf_bytes = _build_receipt_pdf(job_details, worker_name)
    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background-color: #f4f7f6; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
            <h2 style="color: #059669; text-align: center;">PAYMENT RECEIPT</h2>
            <p>Hi,</p>
            <p>We received your payment for <b>{job_details.get('skill', 'Service')}</b> by <b>{worker_name}</b>.</p>
            <p>Total paid: <b>&#8377;{amount}</b></p>
            <p>Your receipt PDF is attached with this email.</p>
            <div style="margin-top: 24px; background: #D1FAE5; color: #059669; padding: 12px 16px; border-radius: 10px; display: inline-block; font-weight: bold;">
                Status: PAID
            </div>
        </div>
    </body>
    </html>
    """
    return _send_document_email(
        customer_email,
        subject="Payment Receipt - SkillMap",
        sender_label="SkillMap Payments",
        body=body,
        attachment_name=f"receipt-{receipt_id}.pdf",
        attachment_bytes=pdf_bytes,
    )
