<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
    <!-- 推广计划 ID -->
    <el-form-item label="计划 ID" prop="plan_id">
      <el-input v-model="form.plan_id" placeholder="由创建推广计划接口返回的 plan_id" />
    </el-form-item>

    <!-- 渠道 -->
    <el-form-item label="渠道" prop="channel_id">
      <el-select v-model="form.channel_id" placeholder="选择渠道" style="width: 100%">
        <el-option v-for="o in channelStore.channelOptions" :key="o.value" v-bind="o" />
      </el-select>
    </el-form-item>

    <!-- 媒体类型 -->
    <el-form-item label="媒体类型" prop="media_type">
      <el-select v-model="form.media_type" placeholder="选择媒体类型" style="width: 100%">
        <el-option v-for="t in MEDIA_TYPES" :key="t" :label="t" :value="t" />
      </el-select>
    </el-form-item>

    <!-- 媒体账号 -->
    <el-form-item label="媒体账号" prop="media_account">
      <el-input v-model="form.media_account" placeholder="在该媒体上的账号名/ID" />
    </el-form-item>

    <!-- 一级分类 -->
    <el-form-item label="一级分类" prop="composition_type">
      <el-radio-group v-model="form.composition_type" @change="onTypeChange">
        <el-radio v-for="(label, val) in COMPOSITION_TYPE_LABELS" :key="val" :value="Number(val)">
          {{ label }}
        </el-radio>
      </el-radio-group>
    </el-form-item>

    <!-- 二级分类 -->
    <el-form-item label="二级分类" prop="composition_sub_type">
      <el-select v-model="form.composition_sub_type" placeholder="选择二级分类" style="width: 100%">
        <el-option
          v-for="subVal in validSubTypes"
          :key="subVal"
          :label="COMPOSITION_SUB_TYPE_LABELS[subVal]"
          :value="subVal"
        />
      </el-select>
    </el-form-item>

    <!-- 作品链接 -->
    <el-form-item label="作品链接" prop="composition_url">
      <el-input v-model="form.composition_url" placeholder="https://..." />
    </el-form-item>

    <!-- 发布时间（作品在第三方平台的发布时间） -->
    <el-form-item label="发布时间" prop="release_time">
      <el-date-picker
        v-model="releaseDate"
        type="datetime"
        placeholder="作品在第三方平台的发布时间"
        style="width: 100%"
        @change="onDateChange"
      />
    </el-form-item>

    <el-form-item>
      <el-button type="primary" :loading="loading" @click="submitForm">提交</el-button>
      <el-button @click="resetForm">重置</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useChannelStore } from '@/stores/channel.store'
import {
  MEDIA_TYPES,
  COMPOSITION_TYPE_LABELS,
  COMPOSITION_SUB_TYPE_LABELS,
  VALID_SUB_TYPE_MAP,
  CompositionType,
  CompositionSubType,
} from '@/constants/enums'
import type { CreateCompositionV2Request } from '@/types/models'

const props = defineProps<{
  loading?: boolean
  initial?: Partial<CreateCompositionV2Request>
}>()

const emit = defineEmits<{
  (e: 'submit', req: CreateCompositionV2Request): void
}>()

const channelStore = useChannelStore()
const formRef = ref<FormInstance>()

const form = reactive<CreateCompositionV2Request>({
  plan_id:              props.initial?.plan_id              ?? '',
  channel_id:           props.initial?.channel_id           ?? '',
  media_type:           props.initial?.media_type           ?? MEDIA_TYPES[0],
  media_account:        props.initial?.media_account        ?? '',
  composition_type:     props.initial?.composition_type     ?? CompositionType.Video,
  composition_sub_type: props.initial?.composition_sub_type ?? CompositionSubType.RealPerson,
  composition_url:      props.initial?.composition_url      ?? '',
  release_time:         props.initial?.release_time         ?? 0,
})

const releaseDate = ref<Date | null>(
  form.release_time ? new Date(form.release_time * 1000) : null,
)

const validSubTypes = computed(() => VALID_SUB_TYPE_MAP[form.composition_type] ?? [])

function onTypeChange() {
  const valids = VALID_SUB_TYPE_MAP[form.composition_type]
  if (valids && !valids.includes(form.composition_sub_type)) {
    form.composition_sub_type = valids[0]
  }
}

function onDateChange(val: Date | null) {
  form.release_time = val ? Math.floor(val.getTime() / 1000) : 0
}

// 同步 initial prop 变更（编辑场景）
watch(() => props.initial, (v) => {
  if (!v) return
  Object.assign(form, v)
  releaseDate.value = v.release_time ? new Date(v.release_time * 1000) : null
})

const rules: FormRules = {
  plan_id:              [{ required: true, message: '请输入计划 ID', trigger: 'blur' }],
  channel_id:           [{ required: true, message: '请选择渠道', trigger: 'change' }],
  media_type:           [{ required: true, message: '请选择媒体类型', trigger: 'change' }],
  media_account:        [{ required: true, message: '请输入媒体账号', trigger: 'blur' }],
  composition_type:     [{ required: true, message: '请选择一级分类', trigger: 'change' }],
  composition_sub_type: [{ required: true, message: '请选择二级分类', trigger: 'change' }],
  composition_url:      [
    { required: true, message: '请输入作品链接', trigger: 'blur' },
    { type: 'url', message: '请输入合法的 URL', trigger: 'blur' },
  ],
  release_time: [
    {
      validator: (_r, v: number, cb) => v > 0 ? cb() : cb(new Error('请选择发布时间')),
      trigger: 'change',
    },
  ],
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  emit('submit', { ...form })
}

function resetForm() {
  formRef.value?.resetFields()
}
</script>
