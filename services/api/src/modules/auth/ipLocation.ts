import { createRequire } from "node:module";
import net from "node:net";
import { logger } from "../../utils/logger.js";

const require = createRequire(import.meta.url);

interface RegionHit {
  country: string;
  province: string;
  city: string;
  isp: string;
}

interface RegionSearcher {
  search(ip: string): RegionHit | null;
}

/**
 * Offline city database (ip2region, about 11 MB). geoip-lite's city data is
 * over 100 MB, which is too large to ship. Names in that database are often
 * Chinese; PLACE_NAMES turns the common ones into English. A name we do not
 * know is kept as stored so the location is not dropped. A private address,
 * or the database's own "internal network" marker, stays blank.
 */
const PLACE_NAMES: Record<string, string> = {
  美国: "United States",
  中国: "China",
  日本: "Japan",
  韩国: "South Korea",
  朝鲜: "North Korea",
  英国: "United Kingdom",
  法国: "France",
  德国: "Germany",
  意大利: "Italy",
  西班牙: "Spain",
  葡萄牙: "Portugal",
  荷兰: "Netherlands",
  比利时: "Belgium",
  瑞士: "Switzerland",
  瑞典: "Sweden",
  挪威: "Norway",
  丹麦: "Denmark",
  芬兰: "Finland",
  爱尔兰: "Ireland",
  奥地利: "Austria",
  波兰: "Poland",
  俄罗斯: "Russia",
  乌克兰: "Ukraine",
  加拿大: "Canada",
  墨西哥: "Mexico",
  巴西: "Brazil",
  阿根廷: "Argentina",
  智利: "Chile",
  澳大利亚: "Australia",
  新西兰: "New Zealand",
  印度: "India",
  印度尼西亚: "Indonesia",
  新加坡: "Singapore",
  马来西亚: "Malaysia",
  泰国: "Thailand",
  越南: "Vietnam",
  菲律宾: "Philippines",
  台湾: "Taiwan",
  香港: "Hong Kong",
  澳门: "Macao",
  以色列: "Israel",
  土耳其: "Turkey",
  南非: "South Africa",
  埃及: "Egypt",
  阿联酋: "United Arab Emirates",
  沙特阿拉伯: "Saudi Arabia",
  加利福尼亚: "California",
  华盛顿: "Washington",
  纽约: "New York",
  德克萨斯: "Texas",
  佛罗里达: "Florida",
  伊利诺伊: "Illinois",
  佐治亚: "Georgia",
  乔治亚: "Georgia",
  马萨诸塞: "Massachusetts",
  弗吉尼亚: "Virginia",
  俄勒冈: "Oregon",
  科罗拉多: "Colorado",
  亚利桑那: "Arizona",
  内华达: "Nevada",
  犹他: "Utah",
  俄亥俄: "Ohio",
  密歇根: "Michigan",
  宾夕法尼亚: "Pennsylvania",
  新泽西: "New Jersey",
  北卡罗来纳: "North Carolina",
  南卡罗来纳: "South Carolina",
  田纳西: "Tennessee",
  密苏里: "Missouri",
  明尼苏达: "Minnesota",
  威斯康星: "Wisconsin",
  马里兰: "Maryland",
  西雅图: "Seattle",
  旧金山: "San Francisco",
  洛杉矶: "Los Angeles",
  圣何塞: "San Jose",
  山景城: "Mountain View",
  纽约市: "New York",
  芝加哥: "Chicago",
  达拉斯: "Dallas",
  休斯顿: "Houston",
  奥斯汀: "Austin",
  波士顿: "Boston",
  亚特兰大: "Atlanta",
  迈阿密: "Miami",
  丹佛: "Denver",
  凤凰城: "Phoenix",
  广东省: "Guangdong",
  北京市: "Beijing",
  上海市: "Shanghai",
  深圳市: "Shenzhen",
  浙江省: "Zhejiang",
  江苏省: "Jiangsu",
  四川省: "Sichuan",
  香港特别行政区: "Hong Kong",
};

const BLANK = new Set(["", "0", "内网IP", "XX", "未知"]);

let searcher: RegionSearcher | null | undefined;

function loadSearcher(): RegionSearcher | null {
  if (searcher !== undefined) return searcher;
  try {
    const loaded = require("ip2region") as { default?: new () => RegionSearcher } | (new () => RegionSearcher);
    const Ctor = typeof loaded === "function" ? loaded : loaded.default;
    searcher = Ctor ? new Ctor() : null;
  } catch (err) {
    logger.warn("IP location lookup is unavailable. Login history will keep the address and leave location blank.", { err });
    searcher = null;
  }
  return searcher;
}

function isNonPublic(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map((part) => Number(part));
    if (a === undefined || b === undefined) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return true;
}

export function placeName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (BLANK.has(trimmed)) return null;
  return PLACE_NAMES[trimmed] ?? trimmed;
}

export function formatLocation(parts: { city?: string | null; region?: string | null; country?: string | null }): string {
  const seen = new Set<string>();
  const bits: string[] = [];
  for (const part of [parts.city, parts.region, parts.country]) {
    const name = placeName(part);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    bits.push(name);
  }
  return bits.join(", ");
}

export interface IpLocation {
  city: string | null;
  region: string | null;
  country: string | null;
  label: string;
}

export function lookupIpLocation(ip: string | null | undefined): IpLocation {
  const blank: IpLocation = { city: null, region: null, country: null, label: "" };
  const trimmed = ip?.trim() ?? "";
  if (!trimmed || !net.isIP(trimmed) || isNonPublic(trimmed)) return blank;
  const hit = loadSearcher()?.search(trimmed);
  if (!hit) return blank;
  const city = placeName(hit.city);
  const region = placeName(hit.province);
  const country = placeName(hit.country);
  return { city, region, country, label: formatLocation({ city, region, country }) };
}
