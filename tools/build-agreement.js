// 生成《拼豆代拼合作协议》Word 模板：node build-agreement.js <输出路径>
// 2026-10-12 版：平台微信支付商户号直连统收、不走分账，按自然月对公结算给乙方（口径同 docs/order-api.md §6）
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, PageBreak, VerticalAlign,
} = require('docx');

const FONT = '宋体';
const SZ = 21; // 10.5pt 正文（五号）

function run(text, opts) {
  return new TextRun(Object.assign({ text, font: { name: FONT, eastAsia: FONT }, size: SZ }, opts || {}));
}
function p(text, opts) {
  opts = opts || {};
  const runs = Array.isArray(text) ? text : [run(text, opts.run)];
  return new Paragraph({
    children: runs,
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: opts.before != null ? opts.before : 60, after: opts.after != null ? opts.after : 60, line: 360 },
    indent: opts.indent ? { firstLine: 420 } : undefined,
  });
}
function title(text) {
  return new Paragraph({
    children: [run(text, { bold: true, size: 36 })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 300 },
  });
}
function h(text) {
  return new Paragraph({
    children: [run(text, { bold: true, size: 24 })],
    spacing: { before: 240, after: 100, line: 360 },
    keepNext: true,
  });
}
function clause(no, text) {
  return p([run(no + '  ', { bold: true }), run(text)], { indent: false });
}
function blank(n) {
  return '＿'.repeat(n || 12);
}

/* ---------- 表格 ---------- */
const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border };
function cell(text, width, opts) {
  opts = opts || {};
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    verticalAlign: VerticalAlign.CENTER,
    shading: opts.head ? { type: ShadingType.CLEAR, fill: 'EDEDED', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      children: [run(text, { bold: !!opts.head, size: 19 })],
      alignment: opts.align || AlignmentType.CENTER,
      spacing: { before: 0, after: 0, line: 300 },
    })],
  });
}
function table(widths, rows) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      children: r.map((t, j) => cell(t, widths[j], { head: i === 0, align: j === 0 && i > 0 && widths.length === 2 ? AlignmentType.LEFT : AlignmentType.CENTER })),
    })),
  });
}

/* ---------- 正文 ---------- */
const parties = [
  p([run('甲方（平台方）：', { bold: true }), run(blank(20))]),
  p('统一社会信用代码：' + blank(18) + '　　注册地址：' + blank(20)),
  p('联系人：' + blank(8) + '　　联系电话：' + blank(12)),
  p(''),
  p([run('乙方（制作方）：', { bold: true }), run(blank(20)), run('（个体工商户填字号；个人填姓名）', { size: 18 })]),
  p('统一社会信用代码：' + blank(20) + '（个体工商户填写）'),
  p('经营者 / 本人姓名：' + blank(10) + '　　身份证号：' + blank(18)),
  p('地址：' + blank(28)),
  p('联系电话：' + blank(12) + '　　微信号：' + blank(12)),
  p(''),
  p('鉴于：甲方运营「拼豆便利店」微信小程序（AppID：wx483d6f0b4bf6eaec，下称「小程序」），为用户提供拼豆图纸生成及「代拼」服务的下单、派单与售后受理；乙方具备拼豆拼制与熨烫定型能力，愿意承接甲方派发的代拼订单。双方本着平等自愿、诚实信用的原则，就代拼合作事宜达成如下协议：', { indent: true }),
];

const body = [
  h('第一条　合作内容与分工'),
  clause('1.1', '用户在小程序内选择作品图纸并支付代拼费用；甲方按本协议将订单派发给乙方；乙方按订单要求完成拼制、熨烫定型，并按用户选择的方式快递寄送或安排用户到店自取。'),
  clause('1.2', '甲方负责：小程序运营与维护、统一定价、向用户收款、派单、用户客服与售后受理、按本协议向乙方结算。'),
  clause('1.3', '乙方负责：接单、备料、制作、包装、发货或交付、售后的实际履行（重做、补发等），以及自取地址与营业时间信息的维护。'),
  clause('1.4', '甲方不向乙方承诺最低订单量。乙方可暂停接单，但应提前 1 日通知甲方；暂停期间甲方不向其派单。'),

  h('第二条　定价'),
  clause('2.1', '乙方的代拼报价见附件一，即乙方每单应得金额。用户价由甲方在乙方报价基础上加计平台服务费与支付通道手续费后统一在小程序公示（用户价 = 乙方报价 ÷ 0.8946，向上取整到角）。附件一报价的调整须经双方书面确认并提前 7 日通知；甲方调整加计方式或用户价不影响乙方报价，已接订单按原报价执行。'),
  clause('2.2', '订单金额由代拼费、格利特加收（如有）及运费（快递订单）构成。代拼费已包含豆子材料与熨烫定型，乙方自备材料并完成熨烫，不得另向用户收取材料费或代烫费。'),

  h('第三条　收款与结算'),
  clause('3.1', '用户款项由用户通过微信支付支付至甲方的微信支付商户号统一收取，再由甲方按本条约定与乙方结算。甲方调整收款渠道的，应提前 7 日书面通知乙方，不影响乙方按本协议应得的金额与结算时效。'),
  clause('3.2', '结算规则：用户实付金额（含运费）中，支付通道手续费（微信支付现行费率 0.6%，以微信支付实际费率为准）先由交易款中扣除，剩余金额甲方收取 10% 作为平台服务费、乙方应得 90%（取整零头归乙方，按 0.6% 费率约合实付金额的 89.46%）。代拼费、格利特费的用户价已按乙方报价加计，保证乙方就该两项应得的金额不低于附件一乙方报价；运费按附件一约定的用户运费收取，同样按上述比例计算乙方应得，乙方拟定运费标准时应据此考虑。乙方应向甲方提供真实有效的收款账户（对公账户或经营者 / 本人名下银行账户，信息见附件二）并保持有效；因乙方账户信息不实、变更未及时通知或账户异常导致结算失败或延误的，由乙方负责处理，甲方在乙方账户恢复正常后补付，不视为甲方逾期。'),
  clause('3.3', '结算周期与支付：订单完成（用户确认收货，或发货 / 通知自取后 10 日内用户未确认由系统自动完成）后计入乙方待结算金额。双方按自然月结算：甲方于次月 10 日前汇总上月完成订单的乙方应得金额，扣除按第 6.3、6.4 条应由乙方承担的退款金额后，将余额一次性转账支付至附件二载明的乙方收款账户，并同时向乙方提供该期结算单（含订单明细、应得合计与扣减明细）。结算周期与支付日双方可另行书面约定调整。'),
  clause('3.4', '除本条约定外，甲方不向乙方收取其他费用。乙方结算所得为含税收入，相关税费由乙方自行承担并依法申报。'),
  clause('3.5', '甲方通过后台向乙方提供订单及结算明细。乙方对明细有异议的，应在收到后 5 日内提出，逾期视为无异议。'),

  h('第四条　派单与履约时效'),
  clause('4.1', '甲方通过企业微信群（或双方另行约定的方式）向乙方发送派单通知，内容包括订单号、作品图纸导入码、尺寸与豆数、每色用量、烫法与豆孔要求、配送方式及收件信息、用户备注。'),
  clause('4.2', '乙方应在收到派单通知后 12 小时内确认接单；无法承接的应在同一时限内告知甲方，由甲方改派。逾期未确认视为拒接，甲方可改派。'),
  clause('4.3', '乙方应在接单后 5 日内完成制作与包装并发货，或通知甲方可供自取。特殊工艺、52×52 以上大尺寸订单可协商延长，但须在接单时确定并告知甲方。'),
  clause('4.4', '快递订单乙方应在发货当日向甲方提供快递公司名称与运单号。'),

  h('第五条　制作与交付标准'),
  clause('5.1', '严格按订单图纸、色号（MARD 标准色系）、烫法及豆孔要求制作，不得擅自替换颜色、改变尺寸。确有缺色的，须经甲方与用户确认后方可替换。'),
  clause('5.2', '材料须为符合国家安全标准的合格拼豆及配件，无异味、无明显色差。'),
  clause('5.3', '成品质量要求：无缺豆、错位、错色、烫花、焦黄、翘曲变形；单面熨烫、表面平整、边缘牢固不脱落。'),
  clause('5.4', '包装应防压防潮。快递选择正规快递公司；实际快递费超出甲方向用户收取的运费部分，由乙方自行承担。'),
  clause('5.5', '到店自取的订单，乙方应提供准确的自取地址与营业时间，成品完成后 1 日内电话联系用户，并至少保管 15 日。'),

  h('第六条　售后与退款'),
  clause('6.1', '用户售后由甲方客服统一受理，乙方应在甲方提出核实要求后 24 小时内回应并配合处理。'),
  clause('6.2', '因乙方原因（错色、缺豆、质量不合格、逾期、发错、包装不当致损等）导致用户要求重做或退款的，由乙方免费重做或承担退款金额；因用户原因或图纸本身问题引起的，由双方协商处理；因不可抗力引起的，双方另行协商。'),
  clause('6.3', '甲方向乙方结算前发生退款的，由甲方直接向用户原路退款，相应订单不计入乙方结算。已向乙方结算后发生退款的，乙方应承担的金额由甲方从乙方下一期结算款中等额扣除；下一期结算款不足扣除的，乙方应在甲方通知后 3 日内将差额退还甲方。'),
  clause('6.4', '因乙方原因导致退款的，退款金额全额由乙方承担（含甲方已收取或应收取的平台服务费部分）；因非乙方原因导致退款的，双方按第 3.2 条约定比例各自承担。'),

  h('第七条　知识产权、数据与保密'),
  clause('7.1', '用户图纸及作品信息仅限用于该订单的制作。乙方不得留存、复制、传播、售卖，不得用于其他客户或自行商业化；订单完成后应删除相关文件（含通过导入码导入的作品）。'),
  clause('7.2', '乙方因履行订单获取的用户姓名、电话、地址等个人信息，仅用于履行该订单，应妥善保管，不得泄露、出售或用于其他用途，并在订单完成后 30 日内删除。'),
  clause('7.3', '小程序、品牌、报价体系、订单数据等属甲方商业信息，未经甲方书面许可乙方不得对外披露。本协议内容双方均应保密。'),
  clause('7.4', '乙方不得绕开甲方与通过小程序获得的用户私下交易或引导用户至其他渠道下单。一经发现，甲方有权立即终止合作并要求乙方赔偿损失。'),

  h('第八条　违约责任'),
  clause('8.1', '乙方逾期交付超过 3 日的，每单扣除该订单乙方应得款项的 10% 作为违约金；超过 7 日的，甲方有权改派并全额扣除该订单乙方应得款项。'),
  clause('8.2', '乙方一个自然月内因质量问题被有效投诉达 3 单的，甲方可暂停派单 1 个月；累计达 6 单的，甲方可终止合作。'),
  clause('8.3', '任一方违反第七条的，应赔偿对方因此遭受的全部损失。'),
  clause('8.4', '甲方无正当理由未按约定结算且拖延超过 15 日的，乙方有权终止合作并要求甲方支付欠款。'),

  h('第九条　期限与终止'),
  clause('9.1', '本协议有效期一年，自双方签署之日起计算；期满前 15 日双方均未提出异议的，自动续期一年，以此类推。'),
  clause('9.2', '任一方可提前 15 日书面通知对方终止本协议；终止前已接订单仍应按约定完成并结算。'),
  clause('9.3', '本协议终止后，第七条继续有效。'),

  h('第十条　其他'),
  clause('10.1', '双方为独立的合作关系，本协议不构成劳动、雇佣、合伙或代理关系。'),
  clause('10.2', '因本协议引起的争议，双方应友好协商；协商不成的，提交甲方所在地有管辖权的人民法院诉讼解决。'),
  clause('10.3', '本协议未尽事宜，双方另行书面约定；附件为本协议不可分割的组成部分，与本协议具有同等效力。'),
  clause('10.4', '本协议一式两份，双方各执一份，自双方签字（盖章）之日起生效。乙方为个体工商户或个人的，由其经营者 / 本人签字并按手印即为有效签署，无需加盖公章；乙方有公章的可一并加盖。'),
  p(''),
  p(''),
];

const sign = [
  table([4680, 4680], [
    ['甲方（盖章）', '乙方（经营者 / 本人签字 + 按手印；有公章可加盖）'],
    ['授权代表：', '经营者 / 本人：'],
    ['', '身份证号：'],
    ['日期：　　　年　　月　　日', '日期：　　　年　　月　　日'],
  ]),
];

/* ---------- 附件三：主体证明材料粘贴页 ---------- */
const { HeightRule } = require('docx');
function tallRow(text, h) {
  return new TableRow({
    height: { value: h, rule: HeightRule.ATLEAST },
    children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA }, borders,
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      children: [new Paragraph({ children: [run(text, { size: 19, color: '8A7B79' })], spacing: { before: 0, after: 0 } })],
    })],
  });
}
const annex3 = [
  new Paragraph({ children: [new PageBreak()] }),
  title('附件三　乙方主体证明材料'),
  p('请附：① 营业执照复印件（个体工商户）；② 经营者 / 本人身份证正反面复印件。复印件上请手写「仅用于拼豆代拼合作及结算」并签字。'),
  p(''),
  new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360], rows: [
    tallRow('营业执照复印件粘贴处', 5200),
    tallRow('经营者 / 本人身份证正反面复印件粘贴处', 5200),
  ] }),
];

/* ---------- 附件 ---------- */
const annex1 = [
  new Paragraph({ children: [new PageBreak()] }),
  title('附件一　乙方代拼报价表'),
  p('（本表为乙方代拼报价，即乙方每单应得金额，已包含豆子材料与单面熨烫定型；用户实付价另按第 2.1 条加计；金额单位：元）'),
  p(''),
  table([4680, 4680], [
    ['豆子数量（实际豆数）', '每颗标准'],
    ['不足 1,600 颗', '0.01 元/颗'],
    ['1,600 颗至 6,083 颗', '0.015 元/颗'],
    ['6,084 颗及以上', '0.02 元/颗'],
    ['作品长边超过 104 格', '根据图纸具体情况另行报价'],
  ]),
  p(''),
  p('计价规则：', { run: { bold: true } }),
  clause('1.', '代拼费 = 实际豆数 × 每颗标准，精确到分，档位按实际豆数、达到哪一档按哪一档（例：1,242 颗为 12.42 元，4,592 颗为 68.88 元）。该费用已包含豆子材料与单面熨烫定型，不另收材料费、代烫费。代拼订单起拼量 100 颗。'),
  clause('2.', '用户选择闪粉类烫法（粗闪 / 细闪）的，按板子档位（取能容纳作品长边的最小板）加收格利特费：10、20、30、40 板 0.50 元，52 板 1.00 元，78 板 1.50 元，104 板 2.00 元。'),
  clause('3.', '运费（快递订单）按收件省份分区向用户收取，此为用户价：浙江省内 6 元；江苏、上海、安徽 8 元；新疆、西藏、内蒙古、青海、甘肃、宁夏、海南 18 元；其他省份 10 元；港澳台暂不寄送。到店自取免运费。运费按第 3.2 条比例计算乙方应得（例：6 元运费乙方约得 5.37 元），运费标准由双方书面确认后调整。'),
  clause('4.', '以上均为乙方报价。用户实付价 = 乙方报价 ÷ 0.8946，向上取整到角（例：1,242 颗乙方报价 12.42 元，用户价 13.90 元，扣除支付通道手续费 0.08 元后余 13.82 元，甲方应得 1.38 元、乙方应得 12.44 元）；运费按第 3 项的用户价收取，不再加计；结算按本协议第三条执行。'),
];

const annex2 = [
  new Paragraph({ children: [new PageBreak()] }),
  title('附件二　乙方收款账户及自取信息'),
  p(''),
  table([2800, 6560], [
    ['项目', '内容（由乙方填写）'],
    ['账户类型', '□ 对公账户（个体工商户）　　□ 经营者 / 本人银行卡'],
    ['营业执照名称 / 统一社会信用代码', ''],
    ['经营者 / 本人姓名', ''],
    ['身份证号', ''],
    ['收款账户：户名 / 开户行 / 账号', ''],
    ['自取地址', ''],
    ['营业 / 取货时间', ''],
    ['企业微信账号（接收派单通知）', ''],
    ['联系电话', ''],
  ]),
  p(''),
  p('说明：', { run: { bold: true } }),
  clause('1.', '以上收款账户用于甲方按本协议第三条向乙方支付结算款项，应为乙方（个体工商户含其经营者本人）名下账户。'),
  clause('2.', '使用银行卡收款的，须为一类借记卡并确保可正常入账；因账户限额、状态异常导致甲方付款失败的，甲方在乙方更正后补付，不视为甲方逾期。'),
  clause('3.', '以上信息变更的，乙方应在变更后 1 日内书面通知甲方；未及时通知导致付款延误或错付的，由乙方自行承担。'),
  p(''),
  p('乙方确认（签字）：' + blank(14) + '　　日期：　　　年　　月　　日'),
];

const doc = new Document({
  creator: '拼豆便利店',
  title: '拼豆代拼合作协议',
  styles: { default: { document: { run: { font: { name: FONT, eastAsia: FONT }, size: SZ } } } },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1500, right: 1500 } } },
    children: [title('拼豆代拼合作协议')].concat(parties, body, sign, annex1, annex2, annex3),
  }],
});

const out = process.argv[2] || 'agreement.docx';
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log('written', out, buf.length + ' bytes');
});
