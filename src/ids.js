import got from 'got';
import { encryptPassword } from './utils/aes.js';
import { solveSliderCaptcha } from './utils/captcha.js';
import * as cheerio from 'cheerio';

class IDSSession {
  constructor(target, username, password, cookieJar, httpResponse = null) {
    this.target = target;
    this.username = username;
    this.password = password;
    this.cookieJar = cookieJar;
    this.httpResponse = httpResponse;

    this.idsUrl = 'https://ids.xidian.edu.cn';
  }

  async login() {
    try {
      // 1. 获取登录页面
      let loginPage;
      try {
        loginPage = await got(this.target, { 
          cookieJar: this.cookieJar,
          followRedirect: false
        });
      } catch (error) {
        throw error.addContext('获取登录页面时出错');
      }

      // 2. 处理验证码
      const needCaptcha = await this.checkNeedCaptcha();
        
      if (needCaptcha) {
        // 处理验证码
        const captchaHandled = await this.handleSliderCaptcha();
        if (!captchaHandled.success && captchaHandled.code === 'MAX_ATTEMPTS') {
          return {
            ...captchaHandled
          }
        } else if (!captchaHandled.success) {
          throw new Error('处理验证码时出现未知错误');
        }
      }

      // 3. 解析表单并提交
      // 添加延迟，避免请求太快
      await new Promise(resolve => setTimeout(resolve, 300));

      return await this.submitLoginForm(loginPage.body);
        
    } catch (error) {
      throw error.addContext('IDS登录流程中出错');
    }
  }

  async checkNeedCaptcha() {
    try {
      const response = await got(`${this.idsUrl}/authserver/checkNeedCaptcha.htl`, {
        searchParams: {
          username: this.username,
          _: Date.now()
        },
        cookieJar: this.cookieJar
      });

      // 解析 JSON 响应
      const data = JSON.parse(response.body);
      return data.isNeed;
    } catch (error) {
      throw error.addContext('检查是否需要验证码时出错');
    }
  }

  async handleSliderCaptcha() {
    let success = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!success && attempts < maxAttempts) {
      attempts++;
      console.log(`尝试滑块验证码 (第${attempts}次)...`);

      try {
        // 1. 获取验证码数据
        let captchaData;
        try {
          const captchaRes = await got(`${this.idsUrl}/authserver/common/openSliderCaptcha.htl`, {
            searchParams: {
              _: Date.now()
            },
            cookieJar: this.cookieJar
          });

          // 解析 JSON 响应
          captchaData = JSON.parse(captchaRes.body);
        } catch (error) {
          throw error.addContext('获取验证码数据时出错');
        }


        // 2. 解决验证码
        const moveLength = await solveSliderCaptcha(captchaData, this.httpResponse);

        if (isNaN(moveLength)) {
          console.log('请输入有效的数字！');
          continue;
        } else {
          try {
            // 提交验证（POST）
            const verifyRes = await got.post(`${this.idsUrl}/authserver/common/verifySliderCaptcha.htl`,{
              headers: {
                'accept': 'application/json, text/javascript, */*; q=0.01',
                'accept-encoding': 'gzip, deflate, br, zstd',
                'accept-language': 'en',
                'connection': 'keep-alive',
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'host': 'ids.xidian.edu.cn',
                'origin': 'https://ids.xidian.edu.cn',
                'referer': this.target,
                'sec-ch-ua': '"Not;A=Brand";v="99", "Microsoft Edge";v="139", "Chromium";v="139"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 Edg/139.0.0.0',
                'x-requested-with': 'XMLHttpRequest'
              },
              form: {
                canvasLength: '280',
                moveLength: moveLength.toString(),
              },
              cookieJar: this.cookieJar
            });

            // 解析验证响应
            const verifyData = JSON.parse(verifyRes.body);
            success = verifyData.errorMsg === 'success';
              
            if (success) {
              console.log('滑块验证码验证成功!');
            } else {
              console.log('滑块验证码验证失败，错误信息:', verifyData?.errorMsg || '未知');
            }
          } catch (error) {
            throw error.addContext('提交验证码时出错');
          }
        }

      } catch (error) {
        throw error.addContext('处理验证码时出错');
      }
    }

    if (!success) {
      return {
        success: false,
        code: 'MAX_ATTEMPTS',
        message: '已连续三次验证失败，请稍后再试'
      }
    }

    return {
      success: true
    };
  }

  async submitLoginForm(html) {
    try {
      // 解析隐藏字段
      const $ = cheerio.load(html);
      const form = $('#pwdFromId')
      const params = {};
      form.find('input[type="hidden"]').each((index, element) => {
          const name = $(element).attr('name');
          const value = $(element).val() || '';
          
          if (name) {
              params[name] = value;
          }
      });
      
      // 获取加密盐值
      const enc = $('#pwdEncryptSalt').val();
      
      // 加密密码
      const encryptedPassword = encryptPassword(this.password, enc);
      
      // 提交登录表单
      const loginForm = {
          ...params,
          username: this.username,
          password: encryptedPassword,
          captcha: '',
          rememberMe: 'true'
      };
      
      const response = await got.post(this.target, {
          headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en',
            'cache-control': 'max-age=0',
            'connection': 'keep-alive',
            'content-type': 'application/x-www-form-urlencoded',
            'host': 'ids.xidian.edu.cn',
            'origin': 'https://ids.xidian.edu.cn',
            'referer': this.target,
            'sec-ch-ua': '"Not;A=Brand";v="99", "Microsoft Edge";v="139", "Chromium";v="139"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 Edg/139.0.0.0'
          },
          form: loginForm,
          cookieJar: this.cookieJar,
          followRedirect: false
      });

      // 检查cookie中是否有'CASTGC'字段，用于检验是否登录成功
      const cookies = await this.cookieJar.getCookies(`${this.idsUrl}/authserver`
      );

      // 查看cookie 
      /*    console.log(
        'IDS cookies:',
        cookies.map(c => `${c.key}@${c.domain}`)
      ); 
      */
      const hasCASTGC = cookies.some(c => c.key === 'CASTGC');
      
      // 获取ticket
      const location = response.headers.location || '';

      const ticketMatch = location.match(/ticket=(ST-[^&]+)/);

      if (!ticketMatch) {
        throw new Error('未获取到 Service Ticket');
      }

      return {
        success: hasCASTGC,
        ticket: ticketMatch[1]
      }
    } catch (error) {
      throw error.addContext('提交登录表单时出错');
    }
  }
}

export { IDSSession };