/**
 * Generate SVG team logo placeholders for 19888 platform
 * Each logo is a colored circle with team initials
 */

const teams = [
  { name: '巴黎圣日耳曼', initials: 'PSG', color: '#004170' },
  { name: '马赛', initials: 'OM', color: '#2FAEE0' },
  { name: '曼城', initials: 'MC', color: '#6CABDD' },
  { name: '利物浦', initials: 'LFC', color: '#C8102E' },
  { name: '皇马', initials: 'RM', color: '#FEBE10' },
  { name: '巴萨', initials: 'FCB', color: '#A50044' },
  { name: '尤文图斯', initials: 'JUVE', color: '#000000' },
  { name: '国米', initials: 'INT', color: '#010E80' },
  { name: '拜仁慕尼黑', initials: 'FCB', color: '#DC052D' },
  { name: '多特蒙德', initials: 'BVB', color: '#FDE100' },
  { name: '巴西', initials: 'BRA', color: '#009C3B' },
  { name: '阿根廷', initials: 'ARG', color: '#75AADB' },
  { name: '法国', initials: 'FRA', color: '#002395' },
  { name: '英格兰', initials: 'ENG', color: '#CF081F' },
  { name: '西班牙', initials: 'ESP', color: '#AA151B' },
  { name: '德国', initials: 'GER', color: '#000000' },
  { name: '葡萄牙', initials: 'POR', color: '#006600' },
  { name: '荷兰', initials: 'NED', color: '#F36C21' },
  { name: '阿森纳', initials: 'AFC', color: '#EF0107' },
  { name: '切尔西', initials: 'CFC', color: '#034694' },
  { name: '克罗地亚', initials: 'CRO', color: '#FF0000' },
  { name: '比利时', initials: 'BEL', color: '#FDDA24' },
  { name: '格鲁吉亚', initials: 'GEO', color: '#DA291C' },
  { name: '罗马尼亚', initials: 'ROU', color: '#002B7F' },
  { name: '摩洛哥', initials: 'MAR', color: '#C1272D' },
  { name: '马达加斯加', initials: 'MAD', color: '#007E3A' },
  { name: '威尔士', initials: 'WAL', color: '#00AD36' },
  { name: '加纳', initials: 'GHA', color: '#006B3F' },
];

const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'img', 'teams');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

teams.forEach(t => {
  const slug = t.name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
  // Dark text or light text based on background brightness
  const r = parseInt(t.color.slice(1, 3), 16);
  const g = parseInt(t.color.slice(3, 5), 16);
  const b = parseInt(t.color.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const textColor = brightness > 150 ? '#111' : '#FFF';

  // Font size based on initials length
  const len = t.initials.length;
  const fontSize = len <= 2 ? 38 : len <= 3 ? 30 : 24;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <radialGradient id="g" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.3)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.15)"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="${t.color}" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
  <circle cx="50" cy="50" r="48" fill="url(#g)"/>
  <text x="50" y="54" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, Helvetica, sans-serif" font-weight="900"
        font-size="${fontSize}" fill="${textColor}" letter-spacing="1">${t.initials}</text>
</svg>`;
  fs.writeFileSync(path.join(dir, slug + '.svg'), svg);
  console.log(`Created ${slug}.svg for ${t.name}`);
});

console.log(`\nDone! ${teams.length} team logos generated in ${dir}`);
