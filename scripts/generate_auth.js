/**
 * 根据 target.xlsx 生成权限配置文件
 * 每位CC用邮箱作为标识，角色自动分配
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..');

// 读取 mapping
const mappingWb = XLSX.readFile(path.join(DATA_DIR, 'mapping.xlsx'));
const mappingData = XLSX.utils.sheet_to_json(mappingWb.Sheets[mappingWb.SheetNames[0]]);
const groupMapping = {};
mappingData.forEach(r => {
  const team = (r['小组'] || '').trim().replace('Team', '小组').replace(/\s+/g, '');
  groupMapping[team] = r['大组'];
});

// 读取 target
const targetWb = XLSX.readFile(path.join(DATA_DIR, 'target.xlsx'));
const targetData = XLSX.utils.sheet_to_json(targetWb.Sheets[targetWb.SheetNames[0]]);

const users = {};

// 管理员（手动配置）
users['admin@yourcompany.com'] = {
  role: 'admin',
  scope: 'all',
  name: '管理员'
};

// 大组长（手动配置邮箱）
const groupLeaders = {
  'Iris': 'iris@yourcompany.com',
  'JOCC-assaf03': 'assaf@yourcompany.com'
};
Object.entries(groupLeaders).forEach(([bg, email]) => {
  users[email] = {
    role: 'group_leader',
    scope: bg,
    name: bg
  };
});

// 根据 target 生成CC和TL账号
targetData.forEach(r => {
  if (!r['CRM账号']) return;
  const crm = r['CRM账号'];
  const position = r['岗位_1'];
  const group = r['七级部门'];

  // 邮箱格式：CRM账号@yourcompany.com（实际使用时替换为真实邮箱）
  const email = `${crm.toLowerCase()}@yourcompany.com`;

  let role = 'cc';
  let scope = crm; // CC只能看自己

  if (position === 'TL') {
    role = 'tl';
    scope = group; // TL可以看整个小组
  } else if (position === 'player coach') {
    role = 'tl';
    scope = group;
  }

  users[email] = {
    role: role,
    scope: scope,
    name: r['姓名'],
    crmAccount: crm,
    group: group,
    bigGroup: groupMapping[group] || '未知'
  };
});

const authConfig = {
  version: '1.0.0',
  generatedAt: new Date().toISOString(),
  description: 'GCC Sales Dashboard 权限配置 - 邮箱为 Cloudflare Access 登录标识',
  users: users
};

const outputPath = path.join(DATA_DIR, 'auth_config.json');
fs.writeFileSync(outputPath, JSON.stringify(authConfig, null, 2), 'utf8');

console.log(`✅ 权限配置已生成: ${outputPath}`);
console.log(`   总用户数: ${Object.keys(users).length}`);
console.log(`   管理员: 1`);
console.log(`   大组长: ${Object.keys(groupLeaders).length}`);
console.log(`   TL: ${targetData.filter(r => r['岗位_1'] === 'TL' || r['岗位_1'] === 'player coach').length}`);
console.log(`   CC: ${targetData.filter(r => r['岗位_1'] === 'CC').length}`);
console.log('\n⚠️  请将 @yourcompany.com 替换为团队成员的真实邮箱');
