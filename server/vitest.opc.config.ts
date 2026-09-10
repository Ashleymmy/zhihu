import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',globals:true,include:['tests/opc/**/*.spec.ts'],fileParallelism:false,maxWorkers:1,testTimeout:20000,hookTimeout:90000,env:{NODE_ENV:'test',OPC_MODULES:'',QUEUE_DRIVER:'memory',JWT_SECRET:'test_opc_secret_longer_than_32_characters',LOG_LEVEL:'silent'}}});

