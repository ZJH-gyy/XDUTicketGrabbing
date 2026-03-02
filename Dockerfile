# 多阶段构建
FROM node:20-slim AS builder

# 1. 安装构建依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# 2. 构建阶段结束，不删除任何东西

FROM node:20-slim

WORKDIR /app

# 3. 只安装运行时依赖和字体
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    fonts-wqy-zenhei \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 4. 从构建阶段复制 node_modules
COPY --from=builder /app/node_modules ./node_modules

# 5. 创建 captchaFiles 目录并设置可写权限
RUN mkdir -p /app/src/captchaFiles && \
    chmod 777 /app/src/captchaFiles && \
    chown -R node:node /app

# 6. 复制源代码
COPY src/ ./src/
COPY config.json ./

# 7. 健康检查（快速响应）
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD node -e "const http = require('http'); const req = http.request('http://localhost:8080/health', {timeout: 2000}, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"


USER node

# 启动应用
CMD ["node", "src/index.js"]