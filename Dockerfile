FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .
COPY docs ./docs


# Build TypeScript code
RUN npm run build

# Expose API port
EXPOSE 3000

# Start the application
CMD ["node", "dist/api/server.js"]