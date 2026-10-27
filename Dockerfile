FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY shared/package.json shared/tsconfig.json ./shared/
COPY backend/package.json backend/tsconfig.json ./backend/
COPY frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html ./frontend/

RUN npm ci

COPY shared/src ./shared/src
COPY backend/src ./backend/src
COPY frontend/src ./frontend/src

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
