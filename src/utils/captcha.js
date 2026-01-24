import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ES module 方式获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 验证码文件目录
const folderDir = join(__dirname, '..', 'captchaFiles');

// 验证码位移设为全局变量，方便从index.js修改
let globalDisplacement = null;

// 表示验证码解决的函数，因需要外部调用设为全局变量
let displacementResolver = null;

async function solveSliderCaptcha(captchaData, httpResponse) {
  try {
	// 将base64编码的图片转换为Buffer
	const originalImageBuffer = Buffer.from(captchaData.bigImage, 'base64');

	// 获取带坐标刻度的图片
	const {markedImageBuffer, scaledWidth} = await addCoordinates(originalImageBuffer);

	// 保存图片
	if (!fs.existsSync(folderDir)) {
	  fs.mkdirSync(folderDir, { recursive: true });
	}
	const originalImageFile = path.join(folderDir, `captcha_original.png`);
	const markedImageFile = path.join(folderDir, `captcha_marked.png`);
	fs.writeFileSync(originalImageFile, originalImageBuffer);
	fs.writeFileSync(markedImageFile, markedImageBuffer);

	// 如果有 HTTP 响应，发送成功消息
	if (httpResponse) {
		httpResponse.writeHead(200, { 'Content-Type': 'application/json' });
		httpResponse.end(JSON.stringify({
			success: true, 
			status: 'ready',
			message: '验证码图片已生成'
		}));
	}

	console.log('⏳ 等待网页输入验证码坐标...');

	// 创建一个 Promise 来等待 displacement
	const displacementPromise = new Promise((resolve, reject) => {
		displacementResolver = resolve;
		
		// 设置5分钟超时
		const displacementTimeout = setTimeout(() => {
			clearDisplacement();
			reject(new Error('等待验证码输入超时（5分钟）'));
		}, 5 * 60 * 1000); // 5分钟
	});

  // 等待 displacement
  const displacement = await displacementPromise;
	
	// 清理临时文件
	try {
		if (fs.existsSync(folderDir)) {
      fs.rmSync(folderDir, { recursive: true, force: true });
    }
	} catch (error) {
	  throw error.addContext('清理临时文件时出错');
	}

	// 280是图片基准宽度，上传水平位移应以此为准
	return Math.floor(Math.round(displacement *280 / scaledWidth));
		
  } catch (error) {
	throw error.addContext('解决验证码时出错');
  }
  
}

// 设置 displacement（供 HTTP 接口调用）
function setDisplacement(value) {
  globalDisplacement = value;
  
  // 如果有等待的 Promise，则解析它
  if (displacementResolver) { 
    displacementResolver(globalDisplacement);
    console.log(`✅ 验证码坐标已接收: ${globalDisplacement}`);
		clearDisplacement();
  }
}

// 清除 displacement
function clearDisplacement() {
  globalDisplacement = null;
	displacementResolver = null;
}

async function addCoordinates(originalImageBuffer) {
  try {
	// 加载图片
	const originalImage = await loadImage(originalImageBuffer);
	
	// 创建画布，实际画布大小不超过此
	const canvas = createCanvas(600, 430);
	const ctx = canvas.getContext('2d');

	// 获取原始图片尺寸
	const imgWidth = originalImage.width;
	const imgHeight = originalImage.height;

	// 计算缩放比例（画布:原图），使图片适应画布
	const scale = Math.min(500 / imgWidth, 350 / imgHeight);
	const scaledWidth = imgWidth * scale;
	const scaledHeight = imgHeight * scale;

	// 重新设置画布大小
	canvas.width = scaledWidth + 100; // 留出坐标空间
	canvas.height = scaledHeight + 80;

	// 清空画布
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// 绘制原始图片，顶部留白小于一半，因为下方要绘制坐标
	ctx.drawImage(originalImage, 50, 30, scaledWidth, scaledHeight);

	// 设置横向坐标样式
	ctx.strokeStyle = '#666';
	ctx.lineWidth = 1;
	ctx.fillStyle = '#333';
	ctx.font = '12px Arial';

	// 绘制横向坐标轴
	ctx.beginPath();
	ctx.moveTo(50, scaledHeight + 40);
	ctx.lineTo(50 + scaledWidth, scaledHeight + 40);
	ctx.stroke();
	
	// 绘制刻度
	const step = 30; // 画布刻度间隔
	for (let i = 0; i <= scaledWidth; i += step) {
	  const x = 50 + i;
		
	  // 绘制刻度线，每5个刻度画长线
	  if (i % (step * 5) === 0) {
		ctx.beginPath();
		ctx.moveTo(x, scaledHeight + 30);
		ctx.lineTo(x, scaledHeight + 50);
		ctx.stroke();
	  } else {
		ctx.beginPath();
		ctx.moveTo(x, scaledHeight + 35);
		ctx.lineTo(x, scaledHeight + 45);
		ctx.stroke();
	  }
	
	  // 绘制刻度值
	  ctx.fillText(i.toString(), x - 10, scaledHeight + 60);
	}

	return {
	  markedImageBuffer: canvas.toBuffer('image/png'),
	  scaledWidth: scaledWidth  
	}
  } catch (error) {
	throw error.addContext('生成带坐标的图片时出错');
  }
}

export {
	solveSliderCaptcha,
	setDisplacement
};