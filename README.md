# CauseConnect — Volunteer Match AI

An AI-powered platform that helps volunteers discover suitable volunteering opportunities and supports event registration workflows.

## Run Locally

### Prerequisites
- Node.js
- npm

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure your local environment variables in `.env.local`. Add the required API keys and configuration values there. Never commit real secrets to GitHub.

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open the local URL printed in your terminal.

## Technology Stack

- React and Vite
- TypeScript
- Supabase
- Browserbase

## Deployment

The frontend can be deployed using a Vite-compatible hosting service. Configure required environment variables in the hosting provider's project settings.

## Security

Never commit API keys, passwords, access tokens, or other secrets. Keep local environment files out of version control.
