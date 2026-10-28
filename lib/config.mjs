// 검색어를 바꾸려면 이 파일을 수정하세요. 주제는 수집 검색어에 따른 분류입니다.
export const topics = {
  '금융': ['기준금리', '은행', '대출', '증시', '주식'],
  '경제': ['물가', '수출', '고용', '부동산'],
  '사회': ['교육', '복지', '노동', '환경'],
  '문화': ['영화', '공연', '전시', '출판'],
  'AI': ['인공지능', '생성형 AI', '챗GPT', 'AI 에이전트'],
  '기타': ['과학', '우주', '스포츠', '게임'],
};
export const trendGroups = [
  { groupName: '금리', keywords: ['기준금리', '금리'] },
  { groupName: '증시', keywords: ['증시', '코스피', '주식'] },
  { groupName: '물가', keywords: ['물가', '소비자물가'] },
  { groupName: '부동산', keywords: ['부동산', '아파트'] },
  { groupName: '문화', keywords: ['영화', '공연', '전시'] },
];

 // 최초 수집 하한: 2026-10-26 00:00 한국 시간. UTC로는 전날 15:00입니다.
export const ARCHIVE_START = '2026-10-26T00:00:00+09:00';
export function collectionCutoff(lastFinishedAt) {
  return Math.max(Date.parse(ARCHIVE_START), lastFinishedAt ? new Date(lastFinishedAt).getTime()-2*86400000 : 0);
}
