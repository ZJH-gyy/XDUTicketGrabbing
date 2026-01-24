const appStartTime = Date.now();

import './utils/error-extensions.js';
import { loadConfig } from './config-loader.js';
import TicketBot from './ticketbot.js';
import schedule from 'node-cron';
import readline from 'readline';
import http from 'http';
import fs from 'fs';
import { setDisplacement } from './utils/captcha.js';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ES module 方式获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configData = loadConfig();

class TicketScheduler {
  constructor() {
    // 设置时区为北京时间
    process.env.TZ = 'Asia/Shanghai';
    console.log('⏰ 时区设置为:', process.env.TZ);

    this.bot = new TicketBot(
      configData,
      () => this.onPromptsStart(),    // prompts 开始时
      () => this.onPromptsEnd()       // prompts 结束时
    );
    this.todayBooked = true;
    this.config = configData.ticket;

    // 初始化控制台输入监听
    this.initConsoleInput();

    // 添加端口监听
    this.startServer();
  }

   // prompts 开始时暂停 readline
  onPromptsStart() {
    console.log('⏸️  prompts 开始，暂停控制台命令监听');
    
    if (this.rl) {
      // 暂停 readline
      this.rl.pause();
      // 临时移除监听器
      this.rl.removeAllListeners('line');
      this.rlPaused = true;
    }
  }
  
  // prompts 结束时恢复 readline
  onPromptsEnd() {
    console.log('▶️  prompts 结束，恢复控制台命令监听');
    
    if (this.rl && this.rlPaused) {
      // 重新创建 readline 接口（更可靠）
      this.rl.close();
      this.initConsoleInput();
      this.rlPaused = false;
    }
  }

  // 初始化控制台输入监听
  initConsoleInput() {
    // 如果已有 rl 实例，先关闭
    if (this.rl) {
      this.rl.close();
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.rl.on('line', async (input) => {
      await this.handleConsoleCommand(input.trim());
    });

    console.log('📝 控制台命令已启用，输入 "/login" 开始登录流程');
  }

  // 处理控制台命令
  async handleConsoleCommand(command) {
    switch (command.toLowerCase()) {
      case '/login':
        console.log('🔐 开始登录流程...');
        await this.checkLoginStatus();
        break;
      case '/grab':
        console.log('开始抢票');
        await this.bot.autoBook();
        break;
    }
  }

  // 添加一个简单的 HTTP 服务器用于健康检查和验证码交互
  startServer() {
    console.log('🌐 开始启动 HTTP 服务器...');
    const PORT = process.env.PORT || 8080;
    
    
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'healthy',
          timestamp: new Date().toISOString(),
          service: 'ticket-bot'
        }));
      }
      // 验证码主界面
      else if (req.url === '/' || req.url === '/captcha') {
        this.bot.idsIsLogged = false;
        const htmlPath = join(__dirname, 'utils', 'captcha_ruler.html');
        fs.readFile(htmlPath, (err, content) => {
          if (err) { res.writeHead(500); res.end('Error loading page.'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content, 'utf-8');
        });
      } 
      // 触发获取验证码的API
      else if (req.url === '/get-captcha' && req.method === 'POST') {
        this.bot.idsIsLogged = false;
        this.bot.idsLogin(null, res).catch(e => console.error(`${e.context} => ${e.message}`));
      }
      else if (req.url === '/submit-captcha' && req.method === 'POST') {
        // 解析请求体
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const displacement = data.displacement;
            
            if (displacement !== undefined) {
              try {
                // 调用 setDisplacement 函数
                setDisplacement(displacement);
                
                console.log(`✅ 通过 HTTP 接收到验证码: ${displacement}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  success: true, 
                  message: `验证码已接收: ${displacement}`
                }));
              } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  success: false, 
                  message: error.message 
                }));
              }
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                message: '缺少 displacement 参数' 
              }));
            }
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              message: '解析请求失败' 
            }));
          }
        });
      }
      // 图片静态文件服务
      else if (req.url === '/example_captcha.png') {
        const imagePath = join(__dirname, 'utils', 'example_captcha.png');
        fs.readFile(imagePath, (err, content) => {
          if (err) { 
            res.writeHead(404); 
            res.end('Image not found'); 
            return; 
          }
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(content, 'binary');
        });
      }
      else if (req.url === `/captcha_marked.png`) {
        const imagePath = join(__dirname, 'captchaFiles', 'captcha_marked.png');
        fs.readFile(imagePath, (err, content) => {
          if (err) { 
            res.writeHead(404); 
            res.end('Image not found'); 
            return; 
          }
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(content, 'binary');
        });
      }
      // 查询登录状态
      else if (req.url === '/login-status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          loggedIn: this.bot.idsIsLogged || false,
          message: this.bot.loginMessage || '未知状态'
        }));
      }

      else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ HTTP 服务器已启动，监听端口: ${PORT}`);
    });

    this.server = server;
  }

  async init() { 
    console.log('🎫 体育馆抢票机器人初始化完成');
    console.log(`⏰ 将在每天 ${this.config.targetTime} 自动抢票`);
    console.log(`⏹️ 将在第 ${this.config.stopTimeDateAdd} 天 ${this.config.stopTime} 停止抢票`);

    // 解析开始和停止时间
    [this.targetHour, this.targetMinute] = this.config.targetTime.split(':').map(Number);
    [this.stopHour, this.stopMinute] = this.config.stopTime.split(':').map(Number);
  }

  // 计算停止时间
  calculateStopTime() {
    const now = new Date();
    
    // 创建停止时间
    this.stopTime = new Date(now);
    this.stopTime.setDate(this.stopTime.getDate() + this.config.stopTimeDateAdd);
    this.stopTime.setHours(this.stopHour, this.stopMinute, 0, 0);
  }

  // 检查是否应该停止
  shouldStop() {
    if (!this.stopTime) return false;
    
    const now = new Date();
    if (now >= this.stopTime) {
      console.log('⏹️  达到停止时间，结束抢票');
      return true;
    }
    
    return false;
  }

  // 检查登录状态
  async checkLoginStatus() {
    try {
      console.log('🔄 正在检查登录状态...');
      const result = await this.bot.autoBook({}, false);
      
      if (result.code && result.code === 'NO_SEND_ORDER') {
        console.log('✅ 登录状态正常，准备就绪');
      } else {
        console.log('⚠️ 登录状态检查异常:', result?.message || '未知错误');
      }
    } catch (error) {
      console.error('💥 登录状态检查失败:', error.message);
    }
  }

  async scheduleDailyTask() {
    const targetMinute = this.targetMinute;
    const targetHour = this.targetHour;

    // 提前半个小时开始准备，如果登录凭证过期则提醒用户重新登录
    const prepareMinute = targetMinute >=30 ? targetMinute - 30 : targetMinute + 30;
    let prepareHour;
    if (targetMinute < 30) {
      prepareHour = targetHour === 0 ? 23 : targetHour - 1;
    } else {
      prepareHour = targetHour;
    }
    
    schedule.schedule(`0 ${prepareMinute} ${prepareHour} * * *`, async () => {
      console.log('🔄 重置今日状态');
      this.todayBooked = false;

      this.checkLoginStatus();
    });

    // 准时开始抢票
    schedule.schedule(`0 ${targetMinute} ${targetHour} * * *`, async () => {
      console.log('⏰ 抢票时间到！');
      
      if (this.todayBooked) {
        console.log('ℹ️ 今日已预订，跳过');
        return;
      }

      await this.startBooking();
    });

    console.log('📅 定时任务已启动');
  }

  async startBooking() {
    console.log('🚀 开始抢票...');

    // 记录开始抢票的日期（用当天的午夜时间来表示）
    const startTime = new Date();
    const startMidnight = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());

    // 设置停止时间
    this.calculateStopTime();
    
    while (!this.todayBooked) {
      try {
        // 如果当前日期比开始日期大（跨天了），dateadd 需要减相应的天数
        const now = new Date();
        const currentMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let dateadd;
        if (currentMidnight !== startMidnight) {
          const daysPassed = Math.floor((currentMidnight - startMidnight) / (1000 * 60 * 60 * 24));

          dateadd = this.config.dateadd - daysPassed;
          if (dateadd < 0) {
            console.error(`dateadd不合法，请检查配置`);
            break;

          } else {
            console.log(`📅 已进入第${daysPassed}天，dateadd调整为: ${dateadd}`);
          }
        }

        const result = await this.bot.autoBook({ dateadd });
        
        if (result.success) {
          // 预订成功
          this.todayBooked = true;
          break;

        } else {
          // 检查是否需要停止
          if (this.shouldStop()) {
            console.log('⏹️ 达到停止时间，结束抢票');
            break;
          }

          console.log(`❌ 本次尝试失败: ${result.message}，等待5秒后重试...`);
          await this.delay(this.config.retryInterval);
        }
        
      } catch (error) {
        console.error('💥 抢票异常:', error.message);
        await this.delay(this.config.retryInterval);
      }
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  start() {
    this.init().then(() => {
      this.scheduleDailyTask();
      
      // 保持进程运行
      setInterval(() => {
        // 心跳检测
        console.log('💓 机器人运行中...', new Date().toLocaleTimeString());
      }, 3600000);
    });
  }
}

// 启动程序
const scheduler = new TicketScheduler();
scheduler.start();

console.log('⏱️ 应用启动耗时:', Date.now() - appStartTime, 'ms');