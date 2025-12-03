# Node.js application Dockerfile
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
# RUN npm ci --only=production
RUN npm install && npm install -g nodemon


# Copy application source
COPY . .

# Copy Docker-specific config as config.js
COPY config.docker.js config.js

# Expose port 80
EXPOSE 80

# Start the application
CMD ["node", "app.js"]
