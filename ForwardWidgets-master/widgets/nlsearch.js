/**
 * AI 自然语言影视搜索模块
 *
 * 用户输入自然语言描述（如「去年的高分科幻片」「类似盗梦空间的悬疑电影」「诺兰执导的作品」），
 * 通过后端 API 调用 LLM 解析意图 + TMDB 搜索，返回匹配结果。
 *
 * 后端通过 userId 进行限流和 Pro 用户识别。
 */

const API_BASE = "https://fluxapi.vvebo.vip/v1/nlsearch";

WidgetMetadata = {
  id: "forward.nlsearch",
  title: "AI 搜索",
  version: "1.1.0",
  requiredVersion: "0.0.1",
  description: "用自然语言描述你想看的内容，AI 理解意图后搜索匹配结果。每日有使用次数限制，Pro 用户可享受更高额度",
  author: "Forward",
  site: "https://github.com/InchStudio/ForwardWidgets",
  modules: [
    {
      id: "aiDiscover",
      title: "AI 发现",
      functionName: "nlSearch",
      cacheDuration: 3600,
      params: [
        {
          name: "keyword",
          title: "描述你想看的内容",
          type: "input",
          value: "随便推荐一点",
          description: "用自然语言描述，AI 帮你找片",
          placeholders: [
            { title: "随便推荐一点", value: "随便推荐一点" },
            { title: "去年高分科幻片", value: "去年高分科幻片" },
            { title: "诺兰的电影", value: "诺兰的电影" },
            { title: "类似盗梦空间", value: "类似盗梦空间" },
          ],
        },
        {
          name: "language",
          title: "语言",
          type: "language",
          value: "zh-CN",
        },
        {
          name: "userId",
          title: "用户 ID",
          type: "userId",
        },
      ],
    },
  ],
  search: {
    title: "AI 搜索",
    functionName: "nlSearch",
    params: [
      {
        name: "keyword",
        title: "搜索关键词",
        type: "input",
        description: "用自然语言描述，AI 帮你找片",
        placeholders: [
          { title: "去年高分科幻片", value: "去年高分科幻片" },
          { title: "诺兰的电影", value: "诺兰的电影" },
          { title: "类似盗梦空间", value: "类似盗梦空间" },
          { title: "最近热门美剧", value: "最近热门美剧" },
        ],
      },
      {
        name: "language",
        title: "语言",
        type: "language",
        value: "zh-CN",
      },
      {
        name: "userId",
        title: "用户 ID",
        type: "userId",
      },
    ],
  },
};

async function nlSearch(params = {}) {
  const keyword = (params.keyword || params.query || "").trim();
  if (!keyword) throw new Error("请输入搜索描述");

  const language = params.language || "zh-CN";

  try {
    const response = await Widget.http.post(
      `${API_BASE}/search`,
      { query: keyword, userId: params.userId || "", language: language },
      { headers: { "Content-Type": "application/json" } }
    );

    const data = response.data;

    if (!data || !data.success) {
      throw new Error((data && data.message) || "搜索失败");
    }

    return data.data || [];
  } catch (error) {
    console.error("[AI搜索] 请求失败:", error.message || error);
    throw new Error("AI 搜索服务暂时不可用，请稍后再试");
  }
}
