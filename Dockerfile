FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY data ./data
COPY db ./db
COPY public ./public
COPY src ./src
COPY tsconfig.json ./tsconfig.json
RUN npx tsc --noEmit false --rewriteRelativeImportExtensions --outDir dist

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY data ./data
COPY db ./db
COPY public ./public
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
