const auth = require("../../utils/auth");
const feedback = require("../../utils/feedback");
Page({
  data: {
    phone: "",
    password: "",
    inviteCode: "",
    displayName: "",
    agreed: false,
    busy: false,
    error: "",
    smsRequired: false,
    policyReady: false,
    policyLoading: false,
    smsCode: "",
    sendingCode: false,
    cooldown: 0,
    codeNotice: "",
  },
  // 分享链接携带邀请码（pages/invite 的转发）：自动预填
  async onLoad(options) {
    if (options && options.code)
      this.setData({ inviteCode: String(options.code).toUpperCase() });
    await this.loadPolicy();
  },
  async loadPolicy() {
    const sequence = this._policySequence = (this._policySequence || 0) + 1;
    const inviteCode = this.data.inviteCode.trim().toUpperCase();
    this.setData({ policyLoading: true, policyReady: false, error: "" });
    try {
      const policy = await auth.registrationPolicy(/^[A-Z2-9]{8}$/.test(inviteCode) ? inviteCode : undefined);
      if (!policy || typeof policy.smsRequired !== 'boolean') throw new Error('无法读取注册规则，请刷新后重试');
      if (!this._disposed && sequence === this._policySequence) this.setData({ smsRequired: policy.smsRequired, policyReady: true });
    } catch (e) {
      if (!this._disposed && sequence === this._policySequence) this.setData({ error: e.message || '无法读取注册规则，请重试' });
    } finally {
      if (!this._disposed && sequence === this._policySequence) this.setData({ policyLoading: false });
    }
  },
  onShow() { this.startCountdown(); },
  onHide() { clearInterval(this._timer); },
  onUnload() { this._disposed = true; clearInterval(this._timer); },
  startCountdown() {
    clearInterval(this._timer);
    const tick = () => {
      const cooldown = Math.max(0, Math.ceil(((this._retryAt || 0) - Date.now()) / 1000));
      this.setData({ cooldown });
      if (!cooldown) clearInterval(this._timer);
    };
    tick();
    if (this.data.cooldown) this._timer = setInterval(tick, 1000);
  },
  async sendCode() {
    if (!this.data.policyReady || !this.data.smsRequired || this.data.sendingCode || this.data.busy || this.data.cooldown) return;
    const phone = this.data.phone.trim(), inviteCode = this.data.inviteCode.trim().toUpperCase();
    if (!/^1\d{10}$/.test(phone)) return this.setData({error:'请输入正确的 11 位手机号'});
    if (!/^[A-Z2-9]{8}$/.test(inviteCode)) return this.setData({error:'请先填写有效的 8 位邀请码'});
    if (!this.data.agreed) return this.setData({error:'请先阅读并同意用户协议和隐私协议'});
    this.setData({sendingCode:true,error:'',codeNotice:'',smsCode:''});
    try {
      const result = await auth.sendRegistrationCode(phone, inviteCode);
      if (this._disposed) return;
      this._retryAt = Date.now() + Math.max(60,Number(result.retryAfterSeconds)||60)*1000;
      this.startCountdown();
      if (phone === this.data.phone.trim()) this.setData({codeNotice:'验证码已发送，5 分钟内有效，请查看手机短信。'});
    } catch(e) {
      if (!this._disposed) this.setData({error:e.message||'发送失败，请稍后重试'});
    } finally {
      if (!this._disposed) this.setData({sendingCode:false});
    }
  },
  input(e) {
    if (e.currentTarget.dataset.name === 'phone') this.setData({smsCode:'',codeNotice:''});
    this.setData({ [e.currentTarget.dataset.name]: e.detail.value });
    if (e.currentTarget.dataset.name === 'inviteCode') {
      this.setData({smsCode:'',codeNotice:''});
      return this.loadPolicy();
    }
  },
  backHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },
  openAgreement(e) {
    wx.navigateTo({
      url: "/pages/agreement/index?type=" + e.currentTarget.dataset.type,
    });
  },
  toLogin() {
    wx.redirectTo({ url: "/pages/login/index" });
  },
  async submit() {
    if (this.data.busy || this.data.sendingCode) return;
    const phone = this.data.phone.trim();
    const password = this.data.password;
    const inviteCode = this.data.inviteCode.trim().toUpperCase();
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ error: "请输入正确的 11 位手机号" });
      return;
    }
    if (password.length < 8) {
      this.setData({ error: "密码至少 8 位" });
      return;
    }
    if (!inviteCode) {
      this.setData({ error: "请填写邀请码，请向邀请人获取" });
      return;
    }
    if (!this.data.policyReady) return this.setData({error:'注册规则尚未加载，请重试'});
    if (this.data.smsRequired && !/^\d{6}$/.test(this.data.smsCode.trim()))
      return this.setData({error:'请输入 6 位短信验证码'});
    // 协议必须主动勾选；未勾选弹窗确认，点「同意」自动勾选并继续
    if (!this.data.agreed) {
      const ok = await feedback.confirm(this, {
        title: "用户协议及隐私协议",
        message:
          "请你务必审慎阅读、充分理解用户协议和隐私协议各条款，包含但不限于用户注意事项、用户行为规范以及为提供服务而收集、使用、存储你个人信息的情况等。如你同意，请点击下方按钮开始接受我们的服务。",
        confirmText: "同意",
        cancelText: "不同意",
      });
      if (!ok) return;
      this.setData({ agreed: true });
    }
    this.setData({ busy: true, error: "" });
    try {
      const user = await auth.register(
        phone,
        password,
        inviteCode,
        this.data.displayName.trim(),
        this.data.smsRequired ? this.data.smsCode.trim() : undefined,
      );
      if (user) wx.reLaunch({ url: auth.entryPath(user) });
    } catch (error) {
      if (error.code === 42220) await this.loadPolicy();
      this.setData({ error: error.message || "注册失败，请重试" });
    } finally {
      this.setData({ busy: false });
    }
  },
});
