Component({
  properties: {
    projects: Array,
    accounts: Array,
    projectIndex: Number,
    accountIndex: Number,
    disabled: Boolean,
  },
  methods: {
    project(e) {
      this.triggerEvent("projectchange", { value: e.detail.value });
    },
    account(e) {
      this.triggerEvent("accountchange", { value: e.detail.value });
    },
  },
});
