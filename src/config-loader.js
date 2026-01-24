import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ES module 方式获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取JSON配置文件
const configPath = join(__dirname, '..', 'config.json');
const configData = JSON.parse(readFileSync(configPath, 'utf8'));

// 辅助函数：处理环境变量类型转换
function parseEnvValue(envValue, envValueName, type = 'string') {
  if (envValue === undefined || envValue === '') {
    return undefined;
  }
  
  // 根据键名判断类型
  switch (type) {
    case 'bool':
      // 布尔值处理
      if (envValue === 'true') {
        return true;
      }

      if (envValue === 'false') {
        return false;
      }
      
      console.warn(`环境变量设置错误，${envValueName}只能是true或false`);
      return undefined;
    
    case 'int':
      // 数字处理
      const num = parseInt(envValue);
      if (isNaN(num)) {
        console.warn(`环境变量设置错误，${envValueName}只能是整数`);
        return undefined;
      }
      return num;

    case 'string':
    default:
      //字符串处理（默认）
      return envValue;
  }
}

export function loadConfig() {  
  return {
    ...configData,
    ticket: {
      ...configData.ticket,
      stopTime: parseEnvValue(process.env.STOP_TIME, 'STOP_TIME', 'string') || configData.ticket.stopTime,
      FieldTypeNo: parseEnvValue(process.env.FIELD_TYPE_NO, 'FIELD_TYPE_NO', 'string') || configData.ticket.FieldTypeNo,
    },
    notification: {
      ...configData.notification,
      SendKey: parseEnvValue(process.env.SEND_KEY, 'SEND_KEY', 'string') || configData.notification.SendKey,
      enable: parseEnvValue(process.env.NOTIFICATION_ENABLE, 'NOTIFICATION_ENABLE', 'bool') ?? configData.notification.enable // 注意数字和布尔值用 ??，因为false和0也是有效值
    }
  };
}