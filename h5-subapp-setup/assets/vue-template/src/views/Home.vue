<script setup>
import { onMounted, ref } from 'vue';

const info = ref(null);
const dark = ref(null);
const error = ref(null);

onMounted(async () => {
  try {
    // 直接使用基座 Bridge 中间件 window.RN
    const [appInfo, darkMode] = await Promise.all([
      window.RN.APP.GETINFO(),
      window.RN.SYSTEM.GETDARKMODE(),
    ]);
    info.value = appInfo;
    dark.value = darkMode.mode;
  } catch (e) {
    error.value = e && e.code ? `${e.code}: ${e.message}` : String(e);
  }
});
</script>

<template>
  <div>
    <h2>首页</h2>
    <p v-if="info">App: {{ info.appVersion }} / Bridge: {{ info.bridgeVersion }} / {{ info.platform }}</p>
    <p v-if="dark">深色模式: <b>{{ dark }}</b></p>
    <p v-if="error" style="color: #b00020">Bridge 调用失败: {{ error }}</p>
  </div>
</template>
