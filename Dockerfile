FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY data ./data
COPY db ./db
COPY public ./public
COPY src ./src
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "server"]
