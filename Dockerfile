# build app
FROM node:16.13.2-alpine as build

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY .parcelrc ./
COPY index.html ./
COPY src ./src
COPY static ./static

RUN npm install
RUN npm run build

# build prod
FROM node:16.13.2-alpine

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY server.js ./
RUN npm install --prod

COPY --from=build /app/dist ./dist
COPY ./.env.production.local ./.env

RUN yarn global add pm2

EXPOSE 9053
ENV NODE_ENV=production
CMD ["pm2-runtime", "server.js"]
