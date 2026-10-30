// 环境配置:后端 API 地址
// 开发:直连本地 pindou-server(开发者工具已在 project.config.json 关闭 urlCheck)
// 发布:改 ENV 为 'prod' 并填生产 HTTPS 域名,同时在小程序后台加入 request 合法域名
const ENV = 'prod'; // App 安装包始终连接生产 HTTPS；本地联调可临时改为 dev。

const HOSTS = {
    // dev: 'http://192.168.50.62:7000',
    dev: 'https://api.pindoubianlidian.com',
    prod: 'https://api.pindoubianlidian.com'
};
module.exports = {
    ENV,
    API_BASE: HOSTS[ENV]
};
