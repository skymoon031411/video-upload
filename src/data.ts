export type Category = '全部影片' | '城市日常' | '自然風景' | '旅行紀錄' | '生活風格' | '創意短片';

export type Video = {
  id: string;
  title: string;
  creator: string;
  category: Category;
  duration: string;
  views: number;
  date: string;
  thumbnail: string;
  videoUrl: string;
  description: string;
  featured?: boolean;
  uploaded?: boolean;
  sourceKind?: 'youtube' | 'vimeo' | 'direct';
  sourceUrl?: string;
  providerLabel?: string;
  submissionId?: string;
  serverStored?: boolean;
  durationSeconds?: number;
  bytes?: number;
};

export const categories: Category[] = ['全部影片', '城市日常', '自然風景', '旅行紀錄', '生活風格', '創意短片'];

export const videos: Video[] = [
  {
    id: 'city-after-dark',
    title: '城市入夜以後',
    creator: '光影研究所',
    category: '城市日常',
    duration: '08:42',
    views: 24800,
    date: '2026-10-08',
    thumbnail: '/media/city-night.svg',
    videoUrl: '/media/demo.mp4',
    description: '當最後一抹日光消失，城市才開始說自己的故事。跟著鏡頭穿梭在燈火之間，收藏那些平常沒有注意到的瞬間。',
  },
  {
    id: 'coastal-walk',
    title: '沿著海岸，慢慢走',
    creator: '山海日記',
    category: '旅行紀錄',
    duration: '12:36',
    views: 18200,
    date: '2026-10-07',
    thumbnail: '/media/island-photo.jpg',
    videoUrl: '/media/demo.mp4',
    description: '沒有趕路的行程，只有沿著海岸的風、潮汐和逐漸變暖的天空。一次把步調放慢的海邊旅行。',
  },
  {
    id: 'beyond-the-mountains',
    title: '山的另一邊',
    creator: '遠方製作',
    category: '自然風景',
    duration: '06:18',
    views: 15600,
    date: '2026-10-06',
    thumbnail: '/media/mountains-photo.jpg',
    videoUrl: '/media/demo.mp4',
    description: '晨光穿過層層山稜，薄霧在山谷之間流動。讓視線跟著風，去看看山的另一邊。',
    featured: true,
  },
  {
    id: 'afternoon-at-the-lake',
    title: '在湖邊留一個下午',
    creator: '靜物時光',
    category: '自然風景',
    duration: '09:05',
    views: 12300,
    date: '2026-10-05',
    thumbnail: '/media/lake.svg',
    videoUrl: '/media/demo.mp4',
    description: '遠山、倒影和一艘緩緩前行的小船。把一個安靜的下午留給湖水，也留給自己。',
  },
  {
    id: 'golden-road',
    title: '下一站，海港',
    creator: '路上影像',
    category: '旅行紀錄',
    duration: '15:24',
    views: 9800,
    date: '2026-10-04',
    thumbnail: '/media/cove-photo.jpg',
    videoUrl: '/media/demo.mp4',
    description: '沿著海邊小鎮的街道，走向泊滿小船的港口。旅程最美的部分，總藏在一個意料之外的轉角。',
  },
  {
    id: 'forest-breath',
    title: '森林裡的呼吸',
    creator: '森間散步',
    category: '自然風景',
    duration: '07:51',
    views: 21400,
    date: '2026-10-03',
    thumbnail: '/media/forest.svg',
    videoUrl: '/media/demo.mp4',
    description: '陽光落在針葉之間，森林的每一層綠都有自己的聲音。一起走進樹影，享受片刻安靜。',
  },
  {
    id: 'rainy-night',
    title: '雨落下的那一晚',
    creator: '街角放映室',
    category: '城市日常',
    duration: '05:32',
    views: 8700,
    date: '2026-10-02',
    thumbnail: '/media/rain-city.svg',
    videoUrl: '/media/demo.mp4',
    description: '雨滴模糊了路燈，也讓街道多了一層柔和的光。用一段影像記下城市偶爾安靜的一面。',
  },
  {
    id: 'window-coffee',
    title: '一杯咖啡的時間',
    creator: '日常編輯部',
    category: '生活風格',
    duration: '04:16',
    views: 11200,
    date: '2026-10-01',
    thumbnail: '/media/coffee-photo.jpg',
    videoUrl: '/media/demo.mp4',
    description: '窗邊的光、溫熱的咖啡和翻到一半的書。生活裡的小小停頓，也值得被好好記錄。',
  },
  {
    id: 'light-and-sand',
    title: '光的形狀',
    creator: '留白工作室',
    category: '創意短片',
    duration: '03:48',
    views: 6900,
    date: '2026-09-30',
    thumbnail: '/media/light-study.svg',
    videoUrl: '/media/demo.mp4',
    description: '用幾何、顏色與移動的光線，寫一首沒有文字的短詩。關於空間，也關於我們如何觀看。',
  },
];
