// 环境配置:后端 API 地址
// 开发:直连本地 pindou-server(开发者工具已在 project.config.json 关闭 urlCheck)
// 发布:改 ENV 为 'prod' 并填生产 HTTPS 域名,同时在小程序后台加入 request 合法域名
const ENV = 'dev'; // 'dev' | 'prod'
// const ENV = 'prod';

const HOSTS = {
  dev: 'http://192.168.50.62:7000',
  prod: 'https://api.pindoubianlidian.com', // TODO: 部署后替换为真实域名
};

module.exports = { API_BASE: HOSTS[ENV] };
