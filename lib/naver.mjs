const base = 'https://naverapihub.apigw.ntruss.com';
export async function naver(path, kind, body, fetcher = fetch) {
  const id = process.env[`NAVER_${kind}_CLIENT_ID`];
  const secret = process.env[`NAVER_${kind}_CLIENT_SECRET`];
  if (!id || !secret) throw new Error(`${kind} API 인증 정보 누락`);
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const res = await fetcher(base+path, {
        method: body ? 'POST' : 'GET',
        headers: {'X-NCP-APIGW-API-KEY-ID':id, 'X-NCP-APIGW-API-KEY':secret, ...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(20000)
      });
      if (!res.ok) {
        if (res.status >= 500 && attempt<2) { await new Promise(r=>setTimeout(r,1000*(attempt+1))); continue; }
        throw new Error(`NAVER ${kind} HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.error || data.errorCode || data.errId) throw new Error(`NAVER ${kind} 응답 오류`);
      return data;
    } catch (e) {
      if (e.message.startsWith('NAVER') || attempt===2) throw e;
      await new Promise(r=>setTimeout(r,1000*(attempt+1)));
    }
  }
}
