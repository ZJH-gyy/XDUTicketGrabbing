/**
 * 扩展Error类以添加上下文信息
  使用方法：
  1. 在内部
    try {
      ...
    } catch (error) {
      throw error.addContext('当前操作信息');
    }
  2. 在最外部
    try {
      ...
    } catch (error) {
      console.error(`${error.context} => ${error.message}`);
    }
 */
Error.prototype.addContext = function(context) {
  if (this.context) {
    this.context = `${context} => ${this.context}`;
  } else {
    this.context = context;
  }
  return this;
};