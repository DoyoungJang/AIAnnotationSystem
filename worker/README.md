# Background worker extension

MVP import/export는 작은 설치에서 즉시 실행됩니다. 대규모 환경에서는 `DatasetService`와 `ExportService` 호출을 Redis/Celery job adapter로 옮기고 API는 job ID를 반환하도록 확장합니다. PHI payload 자체를 queue metadata나 worker log에 넣지 마십시오.
