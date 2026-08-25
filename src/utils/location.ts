import axios from 'axios';
import { getEnvConfigDataAPI } from '@/api/config';

type AmapRegeocode = {
  formatted_address?: string;
  addressComponent?: {
    province?: string;
    city?: string | string[];
    district?: string;
  };
};

function formatRegionAddress(province: string, city: string, district?: string) {
  let region = '';
  if (province && city && province !== city) {
    region = `${province}${city}`;
  } else {
    region = province || city;
  }
  if (district && !region.includes(district)) {
    region += district;
  }
  return region;
}

// 生成省/市/区的组合：省市区、省市、市区（直辖市等重复层级会自动去重）
function buildRegionCombinations(province: string, city: string, district: string) {
  const parts: string[] = [];
  if (province) parts.push(province);
  if (city && city !== province) parts.push(city);
  if (district && district !== city && district !== province) parts.push(district);

  const options: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !options.includes(trimmed)) options.push(trimmed);
  };

  // 省 + 市 + 区
  if (parts.length >= 3) push(parts[0] + parts[1] + parts[2]);
  // 省 + 市
  if (parts.length >= 2) push(parts[0] + parts[1]);
  // 市 + 区
  if (parts.length >= 2) push(parts[parts.length - 2] + parts[parts.length - 1]);

  return options;
}

// 拼接高德逆地理编码返回的位置候选：
// 1. formatted_address（默认）
// 2. 省/市/区的各种组合
function buildAmapLocationOptions(regeocode: AmapRegeocode) {
  const options: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !options.includes(trimmed)) options.push(trimmed);
  };

  push(regeocode.formatted_address || '');

  const comp = regeocode.addressComponent;
  if (comp) {
    const province = comp.province || '';
    const city = (Array.isArray(comp.city) ? comp.city[0] : comp.city) || '';
    const district = (Array.isArray(comp.district) ? comp.district[0] : comp.district) || '';
    buildRegionCombinations(province, city, district).forEach(push);
  }

  return options;
}

async function reverseGeocodeByAmap(lng: number, lat: number, key: string) {
  const { data } = await axios.get('https://restapi.amap.com/v3/geocode/regeo', {
    params: {
      location: `${lng},${lat}`,
      key,
      extensions: 'base',
      coordsys: 'gps',
    },
  });

  if (data?.infocode === '10001') return null;
  if (data.status === '1' && data.regeocode) return data.regeocode as AmapRegeocode;
  return null;
}

async function reverseGeocodeByBigDataCloud(lat: number, lng: number) {
  const { data } = await axios.get('https://api.bigdatacloud.net/data/reverse-geocode-client', {
    params: {
      latitude: lat,
      longitude: lng,
      localityLanguage: 'zh',
    },
  });

  const admin = data.localityInfo?.administrative as { order?: number; name?: string }[] | undefined;
  const province = data.principalSubdivision || admin?.find((item) => item.order === 2)?.name || '';
  const city = data.city || admin?.find((item) => item.order === 3)?.name || '';
  const district =
    (data.locality && data.locality !== city ? data.locality : '') ||
    admin?.find((item) => item.order === 4)?.name ||
    '';

  return formatRegionAddress(province, city, district) || null;
}

// 解析当前位置的候选名称列表，高德优先，失败时降级为 BigDataCloud 单一结果
export async function resolveLocationOptions(lng: number, lat: number, gaodeKey?: string) {
  if (gaodeKey) {
    try {
      const regeocode = await reverseGeocodeByAmap(lng, lat, gaodeKey);
      if (regeocode) {
        const options = buildAmapLocationOptions(regeocode);
        if (options.length) return options;
      }
    } catch (error) {
      console.warn('高德逆地理编码失败，尝试备用方案', error);
    }
  }

  const address = await reverseGeocodeByBigDataCloud(lat, lng);
  return address ? [address] : [];
}

export async function loadGaodeWebKey() {
  try {
    const coordinate = await getEnvConfigDataAPI('gaode_coordinate');
    const coordinateKey = (coordinate.data.value as { key?: string })?.key?.trim();
    if (coordinateKey) return coordinateKey;

    const map = await getEnvConfigDataAPI('gaode_map');
    const mapKey = (map.data.value as { key_code?: string })?.key_code?.trim();
    return mapKey || '';
  } catch {
    return '';
  }
}
