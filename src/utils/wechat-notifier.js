import got from 'got';

async function sendWechatNotification(config, message) {
  if (!config.enable) {
    return {
      success: false,
      code: 'NOT_ENABLED',
      message: '通知未启用'
    }
  }

  if (!config.SendKey) {
    return {
      success: false,
      code: 'NO_SENDKEY',
      message: '未配置SendKey'
    }
  }

  try {
    const encodedMessage = encodeURIComponent(message);
    const url = `https://sctapi.ftqq.com/${config.SendKey}.send?title=${encodeURIComponent(config.title)}&desp=${encodedMessage}`;
        
    const response = await got(url);
        
    // 解析响应体为 JSON
    const responseBody = JSON.parse(response.body);
        
    if (responseBody.code === 0) {
      // 发送成功
      return {
        success: true
      }; 
    } else {
      return {
        success: false,
        code: 'UNKNOWN',
        message: responseBody.message
      }
    }
  } catch (error) {
    throw error;
  }
}

export { sendWechatNotification }