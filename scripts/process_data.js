/**
 * GCC Sales Dashboard - 数据处理+加密脚本
 * 读取Excel/CSV源文件，清洗关联聚合，AES-256加密输出
 */
const XLSX = require('xlsx');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
const DATA_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data');
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'gcc-dashboard-2026-default-key-32b'; // 生产环境通过环境变量设置

// 5月日期范围（Excel序列号）
const MAY_START = 46143; // 2026-05-01
const MAY_END = 46174;   // 2026-06-01（不含）

// GCC 8个小组
const GCC_GROUPS = [
  'ME-JOCC20小组', 'ME-JOCC22小组', 'ME-JOCC24小组', 'ME-JOCC27小组',
  'ME-JOCC35小组', 'ME-JOCC54小组', 'ME-JOCC75小组', 'ME-JOCC85小组'
];

// ========== 工具函数 ==========
function excelDateToJS(serial) {
  if (!serial || serial < 30000) return null;
  return new Date((serial - 25569) * 86400 * 1000);
}

function isInMay(serial) {
  return serial >= MAY_START && serial < MAY_END;
}

function excelDateToDateStr(serial) {
  const d = excelDateToJS(serial);
  if (!d) return null;
  return d.toISOString().split('T')[0];
}

function classifyChannel(rawChannel) {
  if (!rawChannel) return '市场';
  if (rawChannel === '海外转介绍' || rawChannel === '转介绍') return '转介绍';
  return '市场';
}

function encrypt(data, key) {
  // 确保 key 是 32 字节
  const keyBuffer = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    data: encrypted,
    tag: authTag.toString('base64')
  };
}

// ========== 主处理流程 ==========
function main() {
  console.log('🚀 开始处理数据...\n');

  // 1. 读取 mapping.xlsx - 大组小组映射
  console.log('1️⃣  读取 mapping.xlsx...');
  const mappingWb = XLSX.readFile(path.join(DATA_DIR, 'mapping.xlsx'));
  const mappingData = XLSX.utils.sheet_to_json(mappingWb.Sheets[mappingWb.SheetNames[0]]);
  const groupMapping = {}; // 小组 → 大组
  mappingData.forEach(r => {
    const team = (r['小组'] || '').trim();
    // mapping中的小组名是 "ME-JOCC20Team " 格式，需要转换为 "ME-JOCC20小组"
    const teamNormalized = team.replace('Team', '小组').replace(/\s+/g, '');
    groupMapping[teamNormalized] = r['大组'];
  });
  console.log(`   大组映射: ${JSON.stringify(groupMapping, null, 2)}`);

  // 2. 读取 target.xlsx - 人员KPI目标
  console.log('\n2️⃣  读取 target.xlsx...');
  const targetWb = XLSX.readFile(path.join(DATA_DIR, 'target.xlsx'));
  const targetData = XLSX.utils.sheet_to_json(targetWb.Sheets[targetWb.SheetNames[0]]);
  const ccTargets = {}; // key: CRM账号
  targetData.forEach(r => {
    if (!r['CRM账号']) return;
    const crm = r['CRM账号'];
    ccTargets[crm] = {
      id: r['工号'],
      name: r['姓名'],
      group: r['七级部门'],
      bigGroup: groupMapping[r['七级部门']] || '未知',
      category: r['类别'],
      region: r['大区'],
      position: r['岗位_1'],
      workAge: r['工龄'],
      crmAccount: crm,
      location: r['工作地点'],
      status: r['在职状态'],
      targets: {
        orderCount: r['5月单量指标'] || 0,
        totalRevenue: r['5月业绩指标'] || 0,
        refRevenue: r['CC推荐业绩'] || 0,
        validStudents: r['CC大单有效学员'] || 0,
        challengeRevenue: r['5月挑战业绩'] || 0,
        discountFactor: r['打折系数'] || 1,
        financialTotal: r['5月财务标（total）'] || 0,
        financialRef: r['5月财务标（Ref）'] || 0,
        mkt: r['MKT'] || 0
      },
      actual: {
        totalRevenue: 0,
        mktRevenue: 0,
        refRevenue: 0,
        orderCount: 0,
        orders: [],
        // 漏斗指标
        registerCount: 0,
        bookCount: 0,
        attendCount: 0,
        paidStudents: 0,
        // 按国家
        byCountry: {},
        // 按渠道
        byChannel: {}
      }
    };
  });
  console.log(`   已加载 ${Object.keys(ccTargets).length} 位CC的目标数据`);

  // 3. 读取 BI看板订单数据.xlsx - 订单明细
  console.log('\n3️⃣  读取 BI看板订单数据.xlsx...');
  const orderWb = XLSX.readFile(path.join(DATA_DIR, 'BI看板订单数据.xlsx'));
  const orderData = XLSX.utils.sheet_to_json(orderWb.Sheets[orderWb.SheetNames[0]]);
  console.log(`   订单总数: ${orderData.length}`);

  // 按日期汇总（用于趋势图）
  const dailyRevenue = {};

  orderData.forEach(order => {
    if (order['订单状态'] !== 'success') return;

    const salesName = order['销售名称'];
    const revenueUSD = order['支付金额 美元'] || 0;
    const channelType = order['销售渠道类别']; // '市场' 或 '转介绍'
    const payDate = order['支付时间(ymdhms)'];
    const dateStr = excelDateToDateStr(payDate);

    // 按日累计
    if (dateStr) {
      if (!dailyRevenue[dateStr]) dailyRevenue[dateStr] = { total: 0, mkt: 0, ref: 0, count: 0 };
      dailyRevenue[dateStr].total += revenueUSD;
      dailyRevenue[dateStr].count += 1;
      if (channelType === '市场') dailyRevenue[dateStr].mkt += revenueUSD;
      if (channelType === '转介绍') dailyRevenue[dateStr].ref += revenueUSD;
    }

    // 匹配CC
    if (ccTargets[salesName]) {
      ccTargets[salesName].actual.totalRevenue += revenueUSD;
      ccTargets[salesName].actual.orderCount += 1;
      if (channelType === '市场') {
        ccTargets[salesName].actual.mktRevenue += revenueUSD;
      } else if (channelType === '转介绍') {
        ccTargets[salesName].actual.refRevenue += revenueUSD;
      }
      ccTargets[salesName].actual.orders.push({
        orderId: order['订单编号'],
        studentId: order['学生编号'],
        amount: revenueUSD,
        channel: channelType,
        refType: order['转介类型'],
        payDate: dateStr,
        country: order['当前国家/地区'],
        package: order['套餐名称'],
        payMethod: order['支付方式']
      });
    }
  });

  // 4. 读取 Raw Data.csv - 学员漏斗数据
  console.log('\n4️⃣  读取 Raw Data.csv...');
  const rawWb = XLSX.readFile(path.join(DATA_DIR, 'Raw Data.csv'));
  const rawData = XLSX.utils.sheet_to_json(rawWb.Sheets[rawWb.SheetNames[0]]);
  console.log(`   学员总数: ${rawData.length}`);

  // 筛选GCC小组的学员
  let gccStudentCount = 0;
  rawData.forEach(student => {
    const ccGroup = student['末次（当前）分配CC员工组名称'];
    const ccName = student['末次（当前）分配CC员工姓名'];
    
    if (!ccGroup || !GCC_GROUPS.includes(ccGroup)) return;
    gccStudentCount++;

    const country = student['当前国家名称'] || '未知';
    const rawChannel = student['一级渠道'];
    const channel = classifyChannel(rawChannel);
    const regDate = student['注册日期'];
    const bookDate = student['首次体验课约课日期'];
    const attendDate = student['首次体验课出席日期'];
    const isPaid = student['是否1v1大单付费'];

    // 匹配到具体CC
    if (ccName && ccTargets[ccName]) {
      const cc = ccTargets[ccName];

      // 初始化国家维度
      if (!cc.actual.byCountry[country]) {
        cc.actual.byCountry[country] = { register: 0, book: 0, attend: 0, paid: 0 };
      }
      // 初始化渠道维度
      if (!cc.actual.byChannel[channel]) {
        cc.actual.byChannel[channel] = { register: 0, book: 0, attend: 0, paid: 0 };
      }

      // 注册量（5月内）
      if (isInMay(regDate)) {
        cc.actual.registerCount++;
        cc.actual.byCountry[country].register++;
        cc.actual.byChannel[channel].register++;
      }
      // 约课量（5月内）
      if (isInMay(bookDate)) {
        cc.actual.bookCount++;
        cc.actual.byCountry[country].book++;
        cc.actual.byChannel[channel].book++;
      }
      // 出席量（5月内）
      if (isInMay(attendDate)) {
        cc.actual.attendCount++;
        cc.actual.byCountry[country].attend++;
        cc.actual.byChannel[channel].attend++;
      }
      // 大单有效学员（全量，不限5月）
      if (isPaid === 1) {
        cc.actual.paidStudents++;
        cc.actual.byCountry[country].paid++;
        cc.actual.byChannel[channel].paid++;
      }
    }
  });
  console.log(`   GCC相关学员: ${gccStudentCount}`);

  // 5. 汇总数据
  console.log('\n5️⃣  汇总计算...');

  // 按小组汇总
  const groupSummary = {};
  GCC_GROUPS.forEach(g => {
    groupSummary[g] = {
      name: g,
      bigGroup: groupMapping[g] || '未知',
      members: [],
      totals: {
        targetRevenue: 0, actualRevenue: 0,
        targetRef: 0, actualRef: 0,
        targetMkt: 0, actualMkt: 0,
        targetOrders: 0, actualOrders: 0,
        targetChallenge: 0,
        registerCount: 0, bookCount: 0, attendCount: 0, paidStudents: 0
      }
    };
  });

  Object.values(ccTargets).forEach(cc => {
    const g = cc.group;
    if (!groupSummary[g]) return;

    groupSummary[g].members.push(cc.crmAccount);
    groupSummary[g].totals.targetRevenue += cc.targets.financialTotal;
    groupSummary[g].totals.actualRevenue += cc.actual.totalRevenue;
    groupSummary[g].totals.targetRef += cc.targets.financialRef;
    groupSummary[g].totals.actualRef += cc.actual.refRevenue;
    groupSummary[g].totals.targetMkt += cc.targets.mkt;
    groupSummary[g].totals.actualMkt += cc.actual.mktRevenue;
    groupSummary[g].totals.targetOrders += cc.targets.orderCount;
    groupSummary[g].totals.actualOrders += cc.actual.orderCount;
    groupSummary[g].totals.targetChallenge += cc.targets.challengeRevenue;
    groupSummary[g].totals.registerCount += cc.actual.registerCount;
    groupSummary[g].totals.bookCount += cc.actual.bookCount;
    groupSummary[g].totals.attendCount += cc.actual.attendCount;
    groupSummary[g].totals.paidStudents += cc.actual.paidStudents;
  });

  // 按大组汇总
  const bigGroupSummary = {};
  Object.values(groupSummary).forEach(g => {
    const bg = g.bigGroup;
    if (!bigGroupSummary[bg]) {
      bigGroupSummary[bg] = {
        name: bg,
        groups: [],
        totals: { targetRevenue: 0, actualRevenue: 0, targetRef: 0, actualRef: 0, targetMkt: 0, actualMkt: 0, targetOrders: 0, actualOrders: 0, targetChallenge: 0, registerCount: 0, bookCount: 0, attendCount: 0, paidStudents: 0 }
      };
    }
    bigGroupSummary[bg].groups.push(g.name);
    Object.keys(g.totals).forEach(k => {
      bigGroupSummary[bg].totals[k] += g.totals[k];
    });
  });

  // 整体汇总
  const overallSummary = {
    targetRevenue: 0, actualRevenue: 0,
    targetRef: 0, actualRef: 0,
    targetMkt: 0, actualMkt: 0,
    targetOrders: 0, actualOrders: 0,
    targetChallenge: 0,
    registerCount: 0, bookCount: 0, attendCount: 0, paidStudents: 0,
    ccCount: Object.keys(ccTargets).length
  };
  Object.values(ccTargets).forEach(cc => {
    overallSummary.targetRevenue += cc.targets.financialTotal;
    overallSummary.actualRevenue += cc.actual.totalRevenue;
    overallSummary.targetRef += cc.targets.financialRef;
    overallSummary.actualRef += cc.actual.refRevenue;
    overallSummary.targetMkt += cc.targets.mkt;
    overallSummary.actualMkt += cc.actual.mktRevenue;
    overallSummary.targetOrders += cc.targets.orderCount;
    overallSummary.actualOrders += cc.actual.orderCount;
    overallSummary.targetChallenge += cc.targets.challengeRevenue;
    overallSummary.registerCount += cc.actual.registerCount;
    overallSummary.bookCount += cc.actual.bookCount;
    overallSummary.attendCount += cc.actual.attendCount;
    overallSummary.paidStudents += cc.actual.paidStudents;
  });

  // 6. 组装最终数据
  const dashboardData = {
    meta: {
      generatedAt: new Date().toISOString(),
      period: '2026-05',
      region: 'GCC',
      dataRange: {
        orderDateRange: Object.keys(dailyRevenue).sort(),
        totalOrders: orderData.length,
        totalStudents: rawData.length
      }
    },
    overall: overallSummary,
    bigGroups: bigGroupSummary,
    groups: groupSummary,
    ccDetails: ccTargets,
    dailyTrend: dailyRevenue,
    orgTree: groupMapping
  };

  // 7. 输出
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 输出未加密JSON（本地调试用）
  const jsonPath = path.join(OUTPUT_DIR, 'dashboard_data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(dashboardData, null, 2), 'utf8');
  console.log(`\n✅ JSON输出: ${jsonPath}`);

  // 输出加密文件（部署用）
  const encrypted = encrypt(dashboardData, ENCRYPTION_KEY);
  const encPath = path.join(OUTPUT_DIR, 'dashboard.enc');
  fs.writeFileSync(encPath, JSON.stringify(encrypted), 'utf8');
  console.log(`🔒 加密输出: ${encPath}`);

  // 输出统计摘要
  console.log('\n📊 数据摘要:');
  console.log(`   总目标业绩: $${overallSummary.targetRevenue.toFixed(0)}`);
  console.log(`   实际业绩: $${overallSummary.actualRevenue.toFixed(0)}`);
  console.log(`   达成率: ${(overallSummary.actualRevenue / overallSummary.targetRevenue * 100).toFixed(1)}%`);
  console.log(`   总单量: ${overallSummary.actualOrders} / ${overallSummary.targetOrders}`);
  console.log(`   5月注册: ${overallSummary.registerCount}, 约课: ${overallSummary.bookCount}, 出席: ${overallSummary.attendCount}`);
  console.log('\n🎉 处理完成！');
}

main();
