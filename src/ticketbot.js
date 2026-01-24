import got from 'got';
import { CookieJar, Cookie } from 'tough-cookie';
import prompts from 'prompts';
import { IDSSession } from './ids.js';
import { sendWechatNotification } from './utils/wechat-notifier.js';

class TicketBot {
  constructor(configData, onPromptsStart = null, onPromptsEnd = null) {
    this.baseUrl = 'https://tybsouthgym.xidian.edu.cn';
    this.xxcappUrl = 'https://xxcapp.xidian.edu.cn';

    this.idsIsLogged = false;  // ids登录状态，用于手动登录server判断
    
    // 回调函数，用于防止readline和prompt冲突的机制
    this.onPromptsStart = onPromptsStart;
    this.onPromptsEnd = onPromptsEnd;

    // 创建CookieJar实例
    this.cookieJar = new CookieJar(
      undefined,
      {
        rejectPublicSuffixes: false   // 🔥 核心
      }
    );
    
    // 基础请求头配置
    this.baseOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 Edg/139.0.0.0',
        //'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en',
        'sec-ch-ua': '"Not;A=Brand";v="99", "Microsoft Edge";v="139", "Chromium";v="139"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"'
      },
      cookieJar: this.cookieJar
    };

    // API请求配置（JSON请求）
    this.apiOptions = {
      ...this.baseOptions,
      headers: {
        ...this.baseOptions.headers,
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      }
    };

    // 页面请求配置（HTML请求）
    this.pageOptions = {
      ...this.baseOptions,
      headers: {
        ...this.baseOptions.headers,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    };
    
    // 存储配置
    this.config = configData;

    // 从环境变量读取登录凭证
    this.username = process.env.IDS_USERNAME;
    this.password = process.env.IDS_PASSWORD;
  }

  /**
   * 获取场地状态
   */
  async getFieldStatus(params = {}) {
    const defaultParams = {
      dateadd: 2,
      TimePeriod: 2,
      VenueNo: '01',
      FieldTypeNo: '006'
    };
    
    const queryParams = { ...defaultParams, ...params };
    const url = `${this.baseUrl}/Field/GetVenueStateNew`;

    console.log('获取场地状态...');
    
    try {
      const response = await got(url, {
        ...this.apiOptions,
        searchParams: queryParams,
        followRedirect: false
      });

      // 检查是否需要登录
      if (response.statusCode === 302) {
        // 302重定向，说明需要登录
        return {
          success: false,
          code: 'LOGIN_REQUIRED',
          message: '需要登录'
        };

      } else if(response.statusCode === 200) {
        // 200，说明获取成功，解析响应体为 JSON
        return {
          success: true,
          data: JSON.parse(JSON.parse(response.body).resultdata)
        };

      } else {
        throw new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
      } 

    } catch (error) {
      throw error.addContext('获取场地状态时出错');
    }
  }

  /**
   * 尝试自动登录
   */
  async tryAutoLogin() {
    const oauthUrl = `${this.xxcappUrl}//uc/api/oauth/index?appid=200201218103247434&redirect=http%3a%2f%2ftybsouthgym.xidian.edu.cn%2fUser%2fQYLogin&state=STATE`;
    
    console.log('尝试自动登录...');
    
    try {
      const response = await got(oauthUrl, {
        ...this.pageOptions,
        followRedirect: true,
        maxRedirects: 15
      });

      // 检查是否登录成功
      if (response.url.includes('Main.html')) {
        console.log('自动登录成功！');        
        return {
          success: true
        }
      } else if (response.url.includes('authserver/login')) {
        console.log('统一认证已过期，需要手动登录');

        return {
          success: false,
          code: 'NEED_MANUAL',
          message: '需要手动登录',
          loginUrl: response.url
        }
      } else {
        throw new Error('未知自动登录重定向，最终URL：' + response.url);
      }

    } catch (error) {
      throw error.addContext('自动登录时出错');
    }
  }

  /**
   * 手动登录
   */
  async manualLogin(loginUrl) {
    console.log('开始手动登录...');
    
    // 1. 发送手动登录通知到微信
    // 加载服务器信息
    const serverConfig = this.config.server;
    const wechatMessage = `抢票系统登录凭证失效，请前往 ${serverConfig.location} 手动登录`;
    
    try {
      const notificationResult = await sendWechatNotification(this.config.notification, wechatMessage);

      if (notificationResult.success) {
        console.log('已发送手动登录通知到微信');
      } else {
        console.log('微信通知发送失败，原因：', notificationResult.message);
      }
    } catch (error) {
      throw error.addContext('发送微信通知时出错');
    }
    
    // 2. 等待 IDS 登录
    this.idsIsLogged = false;
    const timeoutMinutes = 30; // 30分钟超时
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const checkInterval = 5000; // 每5秒检查一次
    const checkTimes = Math.ceil(timeoutMs / checkInterval);

    for (let i = 0; i < checkTimes; i++) {
      if (this.idsIsLogged) {
        return true;
      }
    }
  }

  async idsLogin(passedLoginUrl, httpResponse = null) {
    const loginUrl = passedLoginUrl || 'https://ids.xidian.edu.cn/authserver/login?service=https%3A%2F%2Fxxcapp.xidian.edu.cn%2Fa_xidian%2Fapi%2Fcas-login%2Findex%3Fredirect%3Dhttps%253A%252F%252Fxxcapp.xidian.edu.cn%252F%252Fuc%252Fapi%252Foauth%252Findex%253Fappid%253D200201218103247434%2526redirect%253Dhttp%25253a%25252f%25252ftybsouthgym.xidian.edu.cn%25252fUser%25252fQYLogin%2526state%253DSTATE%26from%3Dwap';

    try {
      console.log('\n=== 开始 IDS 统一认证登录 ===');
      
      console.log('='.repeat(50));
      
      // 获取账号密码
      const { username, password } = await this.getCredentials();
      if (!username || !password) {
        throw new Error('账号密码不能为空');
      }
      
      // 创建 IDS 会话
      const idsSession = new IDSSession(loginUrl, username, password, this.cookieJar, httpResponse);
      
      // 执行登录
      const idsLoginResult = await idsSession.login();
      
      if (idsLoginResult.success) {
        console.log('✅ IDS 登录成功');
        
        const casLoginUrl = `${this.xxcappUrl}/a_xidian/api/cas-login/index?redirect=https%3A%2F%2Fxxcapp.xidian.edu.cn%2F%2Fuc%2Fapi%2Foauth%2Findex%3Fappid%3D200201218103247434%26redirect%3Dhttp%253a%252f%252ftybsouthgym.xidian.edu.cn%252fUser%252fQYLogin%26state%3DSTATE&from=wap&ticket=${idsLoginResult.ticket}`;

        // 使用ticket获取tybsouthgym.xidian.edu.cn的cookie 
        await got(casLoginUrl, {
          ...this.pageOptions,
          headers: {
            ...this.pageOptions.headers,
            'Cache-Control': 'max-age=0',
            'Referer': 'https://ids.xidian.edu.cn/'
          },
          followRedirect: true,
          maxRedirects: 10,
        });

        // 检查cookie是否获取成功
        const currentCookies = await this.cookieJar.getCookies(this.baseUrl);
        if (currentCookies.some(c => c.key === 'JWTUserToken')) {
          console.log('✅ tybsouthgym.xidian.edu.cn的cookie获取成功');
        } else {
          throw new Error('tybsouthgym.xidian.edu.cn的cookie获取失败');
        }

        this.idsIsLogged = true;
        return true;

      } else {
        throw new Error('IDS 登录失败');
      }
      
    } catch (error) {
      throw error.addContext('自动登录时出错');
    }
  }

  /**
   * 从控制台获取账号密码
   */
  async getCredentials() {
    // 如果环境变量已设置，直接使用
    if (this.username && this.password) {
      console.log('✅ 使用环境变量中的登录凭证');
      return {
        username: this.username,
        password: this.password
      };
    }
    
    // 否则才提示用户输入（本地开发用）
    console.warn('⚠️ 未设置环境变量 IDS_USERNAME/IDS_PASSWORD');

    // 通知开始 prompts
    if (this.onPromptsStart) {
      this.onPromptsStart();
    }

    try {
      const questions = [
        {
          type: 'text',
          name: 'username',
          message: '请输入用户名',
          validate: value => value.trim() ? true : '用户名不能为空'
        },
        {
          type: 'password',  // 自动隐藏输入
          name: 'password',
          message: '请输入密码',
          validate: value => value.trim() ? true : '密码不能为空'
        }
      ];

      const response = await prompts(questions);
      return {
        username: response.username.trim(),
        password: response.password
      };

    } finally {
      // 无论成功还是失败，都通知结束 prompts
      if (this.onPromptsEnd) {
        this.onPromptsEnd();
      }
    }
    
  }

  /**
   * 创建订单
   */
  async createOrder(field, dateadd = 2, VenueNo = '01') {
    const checkdata = JSON.stringify([{
      FieldNo: field.FieldNo,
      FieldTypeNo: field.FieldTypeNo,
      FieldName: field.FieldName,
      BeginTime: field.BeginTime,
      Endtime: field.EndTime,
      Price: field.FinalPrice
    }]);

    const url = `${this.baseUrl}/Field/OrderField`;

    try {
      console.log('发送订单请求:', field.FieldName);    

      const response = await got(url, {
        ...this.apiOptions,
        searchParams: {
          checkdata: checkdata,
          dateadd,
          VenueNo
        },
        followRedirect: false
      });

      // 检查响应状态
      if (response.statusCode !== 200) {
        throw new Error('订单请求失败');
      }

      // 解析响应体为 JSON
      const result = JSON.parse(response.body);
      
      if (result && result.resultdata) {
        console.log('✅ 订单创建成功，请于30分钟内付款！订单编号：', result.resultdata);
        
        // 发送微信通知
        const wechatMessage = `抢票成功，请于30分钟内付款！订单编号：${result.resultdata}`;
    
        try {
          const notificationResult = await sendWechatNotification(this.config.notification, wechatMessage);

          if (notificationResult.success) {
            console.log('已发送手动登录通知到微信');
          } else {
            console.log('微信通知发送失败，原因：', notificationResult.message);
          }
        } catch (error) {
          throw error.addContext('发送微信通知时出错');
        }

        return {
          success: true,
          orderId: result.resultdata
        };

      } else {
        console.log('订单创建失败！原因：', result?.message || '未知错误');
        return {
          success: false,
          code: 'ORDER_REJECTED',
          message: result?.message || '订单创建失败'
        };
      }
    } catch (error) {
      throw new Error('创建订单失败:' + error.message);
    }
  }

  /**
   * 自动抢票主流程
   */
  async autoBook(params = {}, sendOrder = true) {
    // 使用构造函数中加载的配置
    const ticketConfig = this.config.ticket;
    const bookParams = {
      dateadd: params.dateadd || ticketConfig.dateadd,
      TimePeriod: params.TimePeriod || ticketConfig.TimePeriod,
      VenueNo: params.VenueNo || ticketConfig.VenueNo,
      FieldTypeNo: params.FieldTypeNo || ticketConfig.FieldTypeNo
    };
    
    console.log('=== 开始预定 ===');

    try {
      // 1. 尝试获取场地状态
      let fields;
      let i;
      for (i = 0; i <= 2; i++) {
        const fieldStatus = await this.getFieldStatus(bookParams);

        if (fieldStatus.success) {
          fields = fieldStatus.data;
          console.log(`获取场地状态成功！`);
          break;
        } else {
          if (fieldStatus.code === 'LOGIN_REQUIRED') {
            const autoLoginResult = await this.tryAutoLogin();
            
            if (autoLoginResult.success) {
              continue;
            } else {
              const manualLoginResult = await this.manualLogin(autoLoginResult.loginUrl);
              if (manualLoginResult) {
                continue;
              }
            }
          }
        }
      }

      if (i > 2) {
        return {
          success: false,
          code: 'MAX_ATTEMPTS',
          message: '获取场地数据达到最大尝试次数'
        }
      }

      if (!sendOrder) {
        return {
          success: false,
          code: 'NO_SEND_ORDER',
          message: '没有请求订单'
        };
      }

      // 2. 检查场地数据
      if (!fields || !Array.isArray(fields)) {
        throw new Error('获取到的场地数据格式错误');
      }
      
      console.log(`获取到 ${fields.length} 个场地`);

      // 3. 查找可用场地（FieldState === '0' 表示可用）
      const available = fields.filter(f => f.FieldState === '0');
      console.log(`发现 ${available.length} 个可用场地`);

      if (available.length === 0) {
        return {
          success: false,
          code: 'NO_AVAILABLE_FIELDS',
          message: '没有可用场地'
        };
      }

      // 4. 尝试预订第一个可用场地
      const target = available[0];
      console.log(`尝试预订: ${target.FieldName} (${target.FieldNo})`);

      const result = await this.createOrder(target, bookParams.dateadd, bookParams.VenueNo);
      return result;
      
    } catch (error) {
      // 统一错误处理
      error.addContext('抢票流程异常');
      console.error(`${error.context} => ${error.message}`);
    };

    return {
      success: false,
      code: 'UNKNOWN',
      message: '未知'
    }
  }
}

export default TicketBot;