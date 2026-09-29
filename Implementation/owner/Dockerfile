FROM node:22-alpine
WORKDIR /app
# npm ci needs every workspace manifest to validate the lockfile
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY cloud/package.json cloud/
COPY owner/package.json owner/
COPY web/package.json web/
RUN npm ci -w owner -w shared --omit=dev --ignore-scripts
COPY shared shared
COPY owner owner
USER node
CMD ["node", "owner/src/index.js"]
