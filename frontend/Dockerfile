FROM node:20-alpine AS builder

WORKDIR /app
ARG VITE_PUBLIC_READ_ONLY=false
ENV VITE_PUBLIC_READ_ONLY=${VITE_PUBLIC_READ_ONLY}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage — serve with nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
