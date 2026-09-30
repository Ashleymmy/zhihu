import type {
  GuideCard,
  OperationGuideModel,
} from "@zhihu-koc/shared-components";

interface GuideUser {
  id: string;
  role: string;
  parentId?: string | null;
  adminDuty?: string;
  permissions?: string[];
}

/** Guide copy follows existing roles; it neither grants permissions nor invents completed steps. */
export function zhihuOperationGuide(
  user: GuideUser,
  scope: { projectId?: string; accountId?: string } = {},
): OperationGuideModel | null {
  if (
    !["creator", "leader", "operator", "admin", "developer"].includes(user.role)
  )
    return null;
  if (user.role === "admin" && user.adminDuty === "finance") return null;
  const creator = user.role === "creator";
  const leader = user.role === "leader";
  const staff = !creator && !leader;
  const assigned = creator && Boolean(user.parentId);
  const has = (permission: string) =>
    user.permissions?.includes(permission) ?? false;
  const businessPath = (path: string, extra: Record<string, string> = {}) => {
    const query = new URLSearchParams(extra);
    if (scope.projectId) query.set("projectId", scope.projectId);
    if (scope.accountId) query.set("accountId", scope.accountId);
    return "/modules/zhihu/" + path + (query.size ? "?" + query : "");
  };
  const keywordCard: GuideCard = staff
    ? {
        id: "keyword",
        title: "创建关键词",
        description:
          "选好项目、任务和渠道，创建关键词，待同步就绪后分发给成员。",
        instructions: [
          "进入关键词页，确认业务项目和接入账号，点击“创建关键词”。",
          "选择推广任务与渠道，填写关键词、推广内容链接并创建。",
          "等待关键词可领取或可分发。同步失败时核对接入后重试，避免重复创建。",
        ],
        action: { label: "去创建关键词", to: businessPath("operations") },
      }
    : {
        id: "keyword",
        title: assigned ? "接收关键词" : "领取关键词",
        description: assigned
          ? "团长分发后，在“我的关键词”中确认分给你的词，再开始创作。"
          : leader
            ? "领取就绪的关键词，分发给团队达人，也可以分配给自己使用。"
            : "在可领取的词中选择合适的关键词，领取后归属到本人。",
        instructions: assigned
          ? [
              "进入“我的关键词”，查看团长已分发给你的关键词。",
              "没有记录时，联系团长确认关键词分发，并由管理员核对项目权限。",
              "需要新关键词时联系团长或运营创建，再由团长分发。",
            ]
          : [
              "进入关键词页，选择有“领取关键词”按钮的记录。",
              leader
                ? "领取后点击“分发给达人”，选择团队达人或自己。"
                : "新词前 30 分钟为团长优先期，之后独立达人可领取就绪的词。",
              "没有合适的词时，联系运营创建；看不到项目时请管理员核对项目权限。",
            ],
        action: {
          label: assigned ? "查看已分配关键词" : "去领取关键词",
          to: businessPath("operations"),
        },
      };
  const steps: GuideCard[] = [
    keywordCard,
    {
      id: "register",
      title: "登记作品",
      description:
        "发布作品后，选择对应关键词计划，填写媒体账号、作品链接和发布时间。",
      instructions: [
        creator
          ? "在已分配给自己的关键词上点击“提交作品并开始使用”，所属计划会自动带入。"
          : "确认关键词已有执行人，再进入“登记作品”选择对应计划；代登记作品归当前执行人。",
        "填写媒体类型、账号、作品分类、推广链接和发布时间，点击“确认登记”。",
        "多条作品可使用“批量上传”；先核对分析结果，再确认导入。保存本地草稿不会提交知乎。",
      ],
      action: { label: "去登记作品", to: businessPath("works/new") },
      secondaryAction: { label: "查看已登记作品", to: businessPath("works") },
    },
    {
      id: "return",
      title: "回传与审核",
      description:
        "登记后系统自动提交知乎，到作品列表查看提交状态和知乎审核结果。",
      instructions: [
        "登记成功后无需另外回传，系统自动提交。批量上传需完成确认导入后才会提交。",
        "在作品列表查看“同步”和“知乎审核”；“已同步”表示已提交，不等于审核通过。",
        "同步失败或审核未通过时，查看原因并联系运营核对处理，不要反复登记同一作品。",
      ],
      action: { label: "查看回传结果", to: businessPath("works") },
      secondaryAction: {
        label: "查看审核进度",
        to: businessPath("operations", { tab: "works" }),
      },
    },
  ];
  const management: GuideCard[] = [];
  if (!creator) {
    management.push(
      has("project.manage")
        ? {
            id: "projects",
            title: "项目分配",
            description: "在成员编辑中勾选可参与的项目，与成员资料一起保存。",
            instructions: [
              "打开“团队与成员”，找到成员并点击“编辑”。",
              "在“分配项目”中搜索、多选项目，保存修改。",
              "项目权限变更后成员需要重新登录；有使用中关键词的项目需先处理后才能移出。",
              "管理员和运营账号按角色职责访问项目，无需逐个加入。",
            ],
            action: { label: "分配成员项目", to: "/team" },
            secondaryAction: { label: "管理业务项目", to: "/projects" },
          }
        : {
            id: "projects",
            title: "项目分配",
            description:
              "由管理员为成员开通业务项目。分发前确认相关成员已加入同一个项目。",
            instructions: [
              "将成员账号和需要参与的项目告诉管理员。",
              "管理员在“团队与成员 → 编辑 → 分配项目”中保存授权。",
              "成员重新登录后查看关键词；当前角色可协助核对，不能直接修改项目授权。",
            ],
            action: { label: "查看可参与项目", to: "/projects" },
          },
    );
    if (has("team.view"))
      management.push({
        id: "members",
        title: "成员管理",
        description: leader
          ? "邀请或创建团队达人，核对团队归属，管理本人团队的成员资料。"
          : "邀请或创建成员，按职责设置角色、状态和团队归属。",
        instructions: [
          "在“团队与成员”中邀请或创建成员；邀请链接可设置有效期与使用人数。",
          leader
            ? "团长邀请注册的达人自动加入本人团队，项目权限仍需管理员分配。"
            : "管理角色邀请注册的成员默认为独立达人；需要加入团队时在成员编辑中选择团长。",
          "“详情”可核对注册来源和权限；“编辑”中只能调整自己有权管理的成员。",
        ],
        action: { label: "去管理成员", to: "/team" },
      });
    management.push({
      id: "distribute",
      title: "关键词分发",
      description: leader
        ? "把已领取的关键词分发给团队达人，明确执行人后再登记作品。"
        : "把就绪关键词分发给团长或达人，核对执行人后跟进作品回传。",
      instructions: [
        leader
          ? "在已领取关键词上点击“分发给达人”，选择本人团队成员。"
          : "在可分发的关键词上点击“分发给成员”，选择团长或达人。",
        "分给团长的词由团长继续分配执行人；分给独立达人的词由达人直接使用。",
        "分发完成后跟进登记作品与审核进度，已使用的词保留原归属。",
      ],
      action: { label: "去分发关键词", to: businessPath("operations") },
    });
  }
  return {
    storageKey:
      "timo:operation-guide:v1:" +
      user.id +
      ":" +
      (user.role === "developer" ? "admin" : user.role),
    audience: creator
      ? "达人指南"
      : leader
        ? "团长指南"
        : user.role === "operator"
          ? "运营指南"
          : "管理指南",
    description: "关键词 → 登记作品 → 回传与审核，按这三步完成一次推广。",
    steps,
    management,
  };
}
