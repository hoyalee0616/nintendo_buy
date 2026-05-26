FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY nintendo_monitor.js ./

EXPOSE 3000

CMD ["node", "nintendo_monitor.js"]
