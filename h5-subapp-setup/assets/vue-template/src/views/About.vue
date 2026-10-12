<template>
  <div>
    <h2>关于</h2>
    <p>这是 hash 路由的第二个页面。</p>
    <button @click="vibrate">震动一下 (RN.SYSTEM.VIBRATE)</button>
  </div>
</template>

<script setup>
function vibrate() {
  window.RN.SYSTEM.VIBRATE({ duration: 200 }).catch(() => {});
}
</script>
