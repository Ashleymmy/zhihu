import { createApp } from "vue";
import Demo from "./Demo.vue";
import RatesHarness from './RatesHarness.vue';
createApp(new URLSearchParams(location.search).has('rates') ? RatesHarness : Demo).mount("#app");
