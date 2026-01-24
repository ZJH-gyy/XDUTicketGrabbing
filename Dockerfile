FROM node:20-slim

WORKDIR /app

# 安装 canvas 所需的最小依赖
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    pkg-config \
    libpixman-1-dev \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 创建 captchaFiles 目录并设置可写权限
RUN mkdir -p /app/src/captchaFiles && \
    chmod 777 /app/src/captchaFiles && \
    chown -R node:node /app

# 安装依赖
RUN npm ci --only=production

# 复制源代码
COPY src/ ./src/
COPY config.json ./

USER node

# 启动应用
CMD ["node", "src/index.js"]