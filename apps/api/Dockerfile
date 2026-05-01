FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache aws-cli
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/rum-engine/package.json ./packages/rum-engine/package.json
RUN npm install
COPY apps/api ./apps/api
COPY packages/rum-engine ./packages/rum-engine
COPY fixtures ./fixtures
COPY data/mappings ./data/mappings
RUN npm run build -w @rum-tool/rum-engine && npm run build -w @rum-tool/api
EXPOSE 8080
CMD ["npm", "run", "start", "-w", "@rum-tool/api"]
