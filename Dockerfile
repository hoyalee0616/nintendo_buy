FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-nanum \
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install
COPY nintendo_monitor.js ./

EXPOSE 3000
CMD ["node", "nintendo_monitor.js"]
