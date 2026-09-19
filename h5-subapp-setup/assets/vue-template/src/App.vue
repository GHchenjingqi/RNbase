<template>
  <div class="page">
    <h1>H5 子应用 (Vue)</h1>
    <nav>
      <router-link to="/">首页</router-link> |
      <router-link to="/about">关于</router-link>
    </nav>
    <router-view />
  </div>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.page { padding: 20px; max-width: 640px; margin: 0 auto; }
h1 { font-size: 20px; }
nav { margin: 12px 0; font-size: 14px; }
</style>
