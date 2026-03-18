# SkillMap - Hyperlocal Talent Network

A Flask-based web application for connecting local talent with job opportunities.

## Features

- User authentication (Admin, Customer, Partner)
- Job posting and management
- Real-time map tracking
- PWA (Progressive Web App) support
- MongoDB database

## Local Development

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Set up environment variables in `.env` file.

3. Run the app:
   ```bash
   python app.py
   ```

## Deployment on Vercel

1. Push your code to a GitHub repository.

2. Connect your GitHub repo to Vercel.

3. Set environment variables in Vercel dashboard:
   - SECRET_KEY
   - MONGO_URI
   - DB_NAME
   - SMTP_SERVER
   - SMTP_PORT
   - SMTP_USERNAME
   - SMTP_PASSWORD
   - MAIL_DEFAULT_SENDER
   - JWT_EXPIRATION_DELTA

4. Deploy.

## PWA Features

- Service Worker for caching
- Web App Manifest
- Installable on mobile devices