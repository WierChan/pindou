// 烫法示例实拍（代拼下单页：缩略图 + 点开放大）。
// 图在包内 assets/finish/<key>.jpg（220×220 正方形缩略图）与 <key>-l.jpg（长边 640 放大图），
// 由 tests 之外的脚本从商家确认过的实拍压出来（来源 Perlerbeads Studio《拼豆烫法大全》，商家已确认可用）。
// 后端可通过 /api/config 的 order.finishImages（{key: url}）下发高清图覆盖放大图；缩略图始终用包内的。
const { cfg } = require('./config');

const KEYS = ['smooth', 'towel', 'bath', 'glaze', 'paper', 'mesh', 'glitter', 'glitterFine'];

// 放大图下的一句效果说明（和发给商家确认的 PDF 一致）
const DESC = {
  smooth: '盖烫纸熨平，表面平整哑光，豆缝还看得出',
  towel: '垫毛巾熨，表面像绒布，摸起来毛茸茸',
  bath: '垫澡巾熨，颗粒感更粗、哑光',
  glaze: '铺亮膜熨，表面像琉璃一样反光',
  paper: '垫揉皱的烘焙纸熨，随机褶皱、做旧感',
  mesh: '垫网格布熨压，规则的网纹',
  glitter: '粗颗粒闪粉转印，亮片明显、一颗颗看得清',
  glitterFine: '细颗粒闪粉，整体细腻闪光',
};

function has(key) { return KEYS.indexOf(key) >= 0; }
function thumb(key) { return has(key) ? '/assets/finish/' + key + '.jpg' : ''; }
function zoom(key) {
  const remote = cfg.ORDER && cfg.ORDER.finishImages && cfg.ORDER.finishImages[key];
  if (remote) return remote;
  return has(key) ? '/assets/finish/' + key + '-l.jpg' : '';
}
function desc(key) { return DESC[key] || ''; }

module.exports = { KEYS, thumb, zoom, desc };
