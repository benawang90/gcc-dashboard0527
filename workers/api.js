<<<<<<< HEAD
/**
 * Cloudflare Worker - GCC Dashboard
 * 同时托管前端页面 + API数据接口
 * 职责：提供HTML页面 / 验证身份 → 解密数据 → 按权限过滤 → 返回
 */

import indexHtml from '../public/index.html';

// AES-256-GCM 解密
async function decrypt(encryptedData, key) {
  const keyBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);

  const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0));
  const data = Uint8Array.from(atob(encryptedData.data), c => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(encryptedData.tag), c => c.charCodeAt(0));

  // 合并 data + tag（Web Crypto API 要求）
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data);
  combined.set(tag, data.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    combined
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

// 从 Cloudflare Access JWT 提取用户邮箱
function getEmailFromJWT(request) {
  // 优先从 Cloudflare Access header 获取
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;

  try {
    const parts = jwt.split('.');
    const payload = JSON.parse(atob(parts[1]));
    return payload.email || null;
  } catch (e) {
    return null;
  }
}

// 按权限过滤数据
function filterDataByRole(data, userConfig) {
  const { role, scope } = userConfig;

  if (role === 'admin') {
    return data;
  }

  const filtered = JSON.parse(JSON.stringify(data));

  if (role === 'group_leader') {
    const allowedGroups = Object.keys(filtered.groups).filter(g => filtered.groups[g].bigGroup === scope);
    Object.keys(filtered.groups).forEach(g => {
      if (!allowedGroups.includes(g)) delete filtered.groups[g];
    });
    Object.keys(filtered.ccDetails).forEach(cc => {
      if (!allowedGroups.includes(filtered.ccDetails[cc].group)) {
        delete filtered.ccDetails[cc];
      }
    });
    Object.keys(filtered.bigGroups).forEach(bg => {
      if (bg !== scope) delete filtered.bigGroups[bg];
    });
    recalcOverall(filtered);

  } else if (role === 'tl') {
    const allowedGroup = scope;
    Object.keys(filtered.groups).forEach(g => {
      if (g !== allowedGroup) delete filtered.groups[g];
    });
    Object.keys(filtered.ccDetails).forEach(cc => {
      if (filtered.ccDetails[cc].group !== allowedGroup) {
        delete filtered.ccDetails[cc];
      }
    });
    const bigGroup = filtered.groups[allowedGroup]?.bigGroup;
    Object.keys(filtered.bigGroups).forEach(bg => {
      if (bg !== bigGroup) delete filtered.bigGroups[bg];
    });
    recalcOverall(filtered);

  } else if (role === 'cc') {
    const crmAccount = scope;
    Object.keys(filtered.ccDetails).forEach(cc => {
      if (cc !== crmAccount) delete filtered.ccDetails[cc];
    });
    filtered.groups = {};
    filtered.bigGroups = {};
    recalcOverall(filtered);
  }

  return filtered;
}

function recalcOverall(data) {
  const overall = {
    targetRevenue: 0, actualRevenue: 0,
    targetRef: 0, actualRef: 0,
    targetMkt: 0, actualMkt: 0,
    targetOrders: 0, actualOrders: 0,
    targetChallenge: 0,
    registerCount: 0, bookCount: 0, attendCount: 0, paidStudents: 0,
    ccCount: Object.keys(data.ccDetails).length
  };

  Object.values(data.ccDetails).forEach(cc => {
    overall.targetRevenue += cc.targets.financialTotal;
    overall.actualRevenue += cc.actual.totalRevenue;
    overall.targetRef += cc.targets.financialRef;
    overall.actualRef += cc.actual.refRevenue;
    overall.targetMkt += cc.targets.mkt;
    overall.actualMkt += cc.actual.mktRevenue;
    overall.targetOrders += cc.targets.orderCount;
    overall.actualOrders += cc.actual.orderCount;
    overall.targetChallenge += cc.targets.challengeRevenue;
    overall.registerCount += cc.actual.registerCount;
    overall.bookCount += cc.actual.bookCount;
    overall.attendCount += cc.actual.attendCount;
    overall.paidStudents += cc.actual.paidStudents;
  });

  data.overall = overall;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ===== 路由：首页 =====
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(indexHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ===== 路由：API 数据接口 =====
    if (url.pathname === '/api/data') {
      // 1. 验证身份
      const email = getEmailFromJWT(request);
      
      // 如果没有 Cloudflare Access（本地调试或未配置Access）
      // 允许query参数传email用于测试
      const debugEmail = url.searchParams.get('email');
      const userEmail = email || debugEmail;

      if (!userEmail) {
        return new Response(JSON.stringify({ error: '未授权：无法获取用户身份。请确保已配置 Cloudflare Access。' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 2. 查询权限
      let authConfig;
      try {
        const authData = await env.AUTH_KV.get('auth_config');
        if (!authData) throw new Error('KV中无auth_config');
        authConfig = JSON.parse(authData);
      } catch (e) {
        return new Response(JSON.stringify({ error: '权限配置加载失败: ' + e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const userConfig = authConfig.users[userEmail];
      if (!userConfig) {
        return new Response(JSON.stringify({ error: `未授权：邮箱 ${userEmail} 无权限访问` }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 3. 读取并解密数据
      let dashboardData;
      try {
        const encData = await env.DASHBOARD_DATA.get('dashboard_enc');
        if (!encData) throw new Error('KV中无dashboard数据');
        dashboardData = await decrypt(JSON.parse(encData), env.ENCRYPTION_KEY);
      } catch (e) {
        return new Response(JSON.stringify({ error: '数据解密失败: ' + e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 4. 按权限过滤
      const filteredData = filterDataByRole(dashboardData, userConfig);

      // 5. 返回
      return new Response(JSON.stringify({
        user: { email: userEmail, role: userConfig.role, name: userConfig.name },
        data: filteredData
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ===== 其他路由：404 =====
    return new Response('Not Found', { status: 404 });
  }
};
=======
/**
 * Cloudflare Worker - GCC Dashboard API
 * 职责：验证身份 → 解密数据 → 按权限过滤 → 返回
 */

// AES-256-GCM 解密
async function decrypt(encryptedData, key) {
  const keyBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);

  const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0));
  const data = Uint8Array.from(atob(encryptedData.data), c => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(encryptedData.tag), c => c.charCodeAt(0));

  // 合并 data + tag（Web Crypto API 要求）
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data);
  combined.set(tag, data.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    combined
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

// 从 Cloudflare Access JWT 提取用户邮箱
function getEmailFromJWT(request) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;

  try {
    const parts = jwt.split('.');
    const payload = JSON.parse(atob(parts[1]));
    return payload.email || null;
  } catch (e) {
    return null;
  }
}

// 按权限过滤数据
function filterDataByRole(data, userConfig) {
  const { role, scope } = userConfig;

  if (role === 'admin') {
    return data; // 管理员看全部
  }

  const filtered = JSON.parse(JSON.stringify(data)); // 深拷贝

  if (role === 'group_leader') {
    // 大组长：只看本大组的小组和CC
    const allowedGroups = Object.keys(filtered.groups).filter(g => filtered.groups[g].bigGroup === scope);

    // 过滤小组
    Object.keys(filtered.groups).forEach(g => {
      if (!allowedGroups.includes(g)) delete filtered.groups[g];
    });

    // 过滤CC
    Object.keys(filtered.ccDetails).forEach(cc => {
      if (!allowedGroups.includes(filtered.ccDetails[cc].group)) {
        delete filtered.ccDetails[cc];
      }
    });

    // 过滤大组
    Object.keys(filtered.bigGroups).forEach(bg => {
      if (bg !== scope) delete filtered.bigGroups[bg];
    });

    // 重算overall为本大组的汇总
    recalcOverall(filtered);

  } else if (role === 'tl') {
    // TL：只看本小组
    const allowedGroup = scope;

    Object.keys(filtered.groups).forEach(g => {
      if (g !== allowedGroup) delete filtered.groups[g];
    });

    Object.keys(filtered.ccDetails).forEach(cc => {
      if (filtered.ccDetails[cc].group !== allowedGroup) {
        delete filtered.ccDetails[cc];
      }
    });

    // 只保留本小组所属大组
    const bigGroup = filtered.groups[allowedGroup]?.bigGroup;
    Object.keys(filtered.bigGroups).forEach(bg => {
      if (bg !== bigGroup) delete filtered.bigGroups[bg];
    });

    recalcOverall(filtered);

  } else if (role === 'cc') {
    // CC：只看自己
    const crmAccount = scope;

    Object.keys(filtered.ccDetails).forEach(cc => {
      if (cc !== crmAccount) delete filtered.ccDetails[cc];
    });

    // 清空组级数据
    filtered.groups = {};
    filtered.bigGroups = {};

    recalcOverall(filtered);
  }

  return filtered;
}

function recalcOverall(data) {
  const overall = {
    targetRevenue: 0, actualRevenue: 0,
    targetRef: 0, actualRef: 0,
    targetMkt: 0, actualMkt: 0,
    targetOrders: 0, actualOrders: 0,
    targetChallenge: 0,
    registerCount: 0, bookCount: 0, attendCount: 0, paidStudents: 0,
    ccCount: Object.keys(data.ccDetails).length
  };

  Object.values(data.ccDetails).forEach(cc => {
    overall.targetRevenue += cc.targets.financialTotal;
    overall.actualRevenue += cc.actual.totalRevenue;
    overall.targetRef += cc.targets.financialRef;
    overall.actualRef += cc.actual.refRevenue;
    overall.targetMkt += cc.targets.mkt;
    overall.actualMkt += cc.actual.mktRevenue;
    overall.targetOrders += cc.targets.orderCount;
    overall.actualOrders += cc.actual.orderCount;
    overall.targetChallenge += cc.targets.challengeRevenue;
    overall.registerCount += cc.actual.registerCount;
    overall.bookCount += cc.actual.bookCount;
    overall.attendCount += cc.actual.attendCount;
    overall.paidStudents += cc.actual.paidStudents;
  });

  data.overall = overall;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
  'Content-Type': 'application/json'
};

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. 验证身份
    const email = getEmailFromJWT(request);
    if (!email) {
      return new Response(JSON.stringify({ error: '未授权：无法获取用户身份' }), {
        status: 401,
        headers: corsHeaders
      });
    }

    // 2. 查询权限（从 KV 或内嵌配置）
    let authConfig;
    try {
      const authData = await env.AUTH_KV.get('auth_config');
      authConfig = JSON.parse(authData);
    } catch (e) {
      return new Response(JSON.stringify({ error: '权限配置加载失败' }), {
        status: 500,
        headers: corsHeaders
      });
    }

    const userConfig = authConfig.users[email];
    if (!userConfig) {
      return new Response(JSON.stringify({ error: '未授权：无权限访问此看板', email }), {
        status: 403,
        headers: corsHeaders
      });
    }

    // 3. 读取并解密数据
    let dashboardData;
    try {
      const encResponse = await fetch(`${new URL(request.url).origin}/data/dashboard.enc`);
      const encData = await encResponse.json();
      dashboardData = await decrypt(encData, env.ENCRYPTION_KEY);
    } catch (e) {
      return new Response(JSON.stringify({ error: '数据解密失败', detail: e.message }), {
        status: 500,
        headers: corsHeaders
      });
    }

    // 4. 按权限过滤
    const filteredData = filterDataByRole(dashboardData, userConfig);

    // 5. 返回
    return new Response(JSON.stringify({
      user: { email, role: userConfig.role, name: userConfig.name },
      data: filteredData
    }), {
      status: 200,
      headers: corsHeaders
    });
  }
};
>>>>>>> c40b43a1c86da05335c1414a1794a7499cd579fb
