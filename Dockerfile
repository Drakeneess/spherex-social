# AstroGram web: production React/Vite build, served by nginx on Railway.
# This file lives at the repository root so Railway can build a second
# service independently of the API service rooted at /server.
FROM node:22-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Browser requests remain same-origin and are forwarded to the API by nginx.
RUN npm run build

FROM nginx:1.27-alpine
COPY web/nginx.railway.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
